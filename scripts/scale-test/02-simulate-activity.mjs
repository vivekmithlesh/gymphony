// =============================================================================
// PHASE 3 — ACTIVITY SIMULATION
// scale-test / 02-simulate-activity.mjs
// -----------------------------------------------------------------------------
// Exercises the realtime subscriptions (not just row counts) for a SUBSET of the
// TEST_ members. Each event writes the SAME tables the real flows write, so an
// owner dashboard left open will light up exactly as in production:
//
//   • check_ins  INSERT     → owner `dashboard_realtime_*` check_ins(gym_id) +
//                             member-dashboard check_ins(member_id)
//   • activity_log INSERT   → owner notifications + recent-activity refetch
//                             (this is what process_wall_checkin writes too)
//   • payments   INSERT     → owner fetchMembersCounts refetch (revenue/dues)
//   • profiles   UPDATE     → membership update (status flip) → counts refetch
//
// Two modes:
//   --bulk            insert everything as fast as batching allows (DB load test)
//   --live            DRIP events with a delay so you can watch the dashboard
//                     update in real time (realtime / re-render storm test)
//
// Usage:
//   node scripts/scale-test/02-simulate-activity.mjs --subset=50 --bulk
//   node scripts/scale-test/02-simulate-activity.mjs --subset=30 --live --delay=400
//
// NOTE on profiles UPDATE: the membership-lockdown trigger (20260607) blocks
//   status/plan/expiry changes unless the gym owner makes them or the activation
//   RPC sets its flag. We therefore drive membership updates via the production
//   RPC `app_activate_member` (service-role can call it) instead of a raw update,
//   so we exercise the REAL activation write path. Pass --no-membership to skip.
// =============================================================================

import { supabase, resolveGym, parseFlags, runPool, sleep } from "./config.mjs";

const flags = parseFlags();
const SUBSET = Number(flags.subset ?? 50);
const LIVE = Boolean(flags.live);
const DELAY = Number(flags.delay ?? 400); // ms between live events
const DO_MEMBERSHIP = !flags["no-membership"];

const gym = await resolveGym();

// Pull a subset of TEST_ members to act on.
const { data: members, error } = await supabase
  .from("members")
  .select("id, member_name, membership_plan, status")
  .eq("gym_id", gym.id)
  .like("member_name", "TEST_Member_%")
  .limit(SUBSET);

if (error) {
  console.error("❌ Could not load test members:", error.message);
  process.exit(1);
}
if (!members?.length) {
  console.error("❌ No TEST_ members found. Run 01-generate-members.mjs first.");
  process.exit(1);
}
console.log(`🎯 Simulating activity for ${members.length} members (${LIVE ? "LIVE drip" : "BULK"} mode).`);

const PLAN_PRICE = { Monthly: 1000, Quarterly: 2500, "Half-Yearly": 4500, Yearly: 8000 };
const now = () => new Date().toISOString();

let checkins = 0;
let payments = 0;
let activations = 0;

async function emitCheckIn(m) {
  const { error } = await supabase.from("check_ins").insert({
    member_id: m.id,
    gym_id: gym.id,
    status: "granted",
    check_in_time: now(),
  });
  if (error) return console.error(`  ✗ check_in ${m.member_name}: ${error.message}`);
  checkins++;

  // Mirror process_wall_checkin: write the owner activity feed so the
  // notifications + recent-activity realtime path is exercised too.
  await supabase.from("activity_log").insert({
    gym_owner_id: gym.gym_owner_id,
    activity_type: "attendance",
    description: `${m.member_name} checked in (scale test).`,
    is_read: false,
  });
}

async function emitPayment(m) {
  const amount = PLAN_PRICE[m.membership_plan] ?? 1000;
  const { error } = await supabase.from("payments").insert({
    member_id: m.id,
    gym_owner_id: gym.gym_owner_id,
    gym_id: gym.id,
    amount,
    plan_name: m.membership_plan,
    status: "pending_verification", // owner must approve — matches member UPI flow
    payment_method: "Cash",
    payment_date: now(),
  });
  if (error) return console.error(`  ✗ payment ${m.member_name}: ${error.message}`);
  payments++;
}

async function emitMembershipUpdate(m) {
  // Real activation path (sets the lockdown flag inside the SECURITY DEFINER fn).
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + 1);
  const { error } = await supabase.rpc("app_activate_member", {
    p_member: m.id,
    p_plan: m.membership_plan,
    p_expiry: expiry.toISOString(),
  });
  if (error) return console.error(`  ✗ activate ${m.member_name}: ${error.message}`);
  activations++;
}

const startedAt = Date.now();

if (LIVE) {
  // Drip one member's worth of events at a time so realtime/UX is observable.
  for (const m of members) {
    await emitCheckIn(m);
    if (Math.random() < 0.4) await emitPayment(m);
    if (DO_MEMBERSHIP && Math.random() < 0.3) await emitMembershipUpdate(m);
    process.stdout.write(`\r  live events → check_ins:${checkins} payments:${payments} activations:${activations}   `);
    await sleep(DELAY);
  }
  console.log("");
} else {
  // BULK: parallel but pooled so we don't open hundreds of sockets at once.
  await runPool(members, 10, async (m, i) => {
    await emitCheckIn(m);
    if (i % 2 === 0) await emitPayment(m);
    if (DO_MEMBERSHIP && i % 3 === 0) await emitMembershipUpdate(m);
  });
}

const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\n✅ Simulation done in ${secs}s — check_ins:${checkins}, payments:${payments}, activations:${activations}.\n` +
    `   Watch the owner dashboard (Dashboard + Members + Revenue tabs) while this runs.`
);
