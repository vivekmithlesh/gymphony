// =============================================================================
// PHASE 2 — TEST DATA GENERATION
// scale-test / 01-generate-members.mjs
// -----------------------------------------------------------------------------
// Creates N TEST_ members for TEST_GYM_ID by INSERTING into the `members` view
// (the same path the owner dashboard's "Add Member" uses — handleSaveMember),
// so the view's INSTEAD-OF trigger writes profiles + generates short_id exactly
// like production. Inserted in safe batches with progress logging.
//
// Usage:
//   node scripts/scale-test/01-generate-members.mjs            # default 500
//   node scripts/scale-test/01-generate-members.mjs --count=500 --batch=50
//   node scripts/scale-test/01-generate-members.mjs --active=0.7  # 70% Active
//
// No SMS / email / WhatsApp / webhook fires — this is a pure DB insert.
// =============================================================================

import { supabase, resolveGym, testName, testPhone, parseFlags } from "./config.mjs";

const flags = parseFlags();
const COUNT = Number(flags.count ?? 500);
const BATCH = Number(flags.batch ?? 50);
const ACTIVE_RATIO = Number(flags.active ?? 0.7); // share that start Active
const PLANS = ["Monthly", "Quarterly", "Half-Yearly", "Yearly"];
const PLAN_MONTHS = { Monthly: 1, Quarterly: 3, "Half-Yearly": 6, Yearly: 12 };

const gym = await resolveGym();

// Skip indices that already exist so the script is re-runnable (idempotent-ish).
const { data: existing } = await supabase
  .from("members")
  .select("member_name")
  .eq("gym_id", gym.id)
  .like("member_name", "TEST_Member_%");
const taken = new Set((existing ?? []).map((r) => r.member_name));
console.log(`ℹ️  ${taken.size} TEST_ members already exist for this gym.`);

const rows = [];
for (let i = 1; i <= COUNT; i++) {
  const name = testName(i);
  if (taken.has(name)) continue;
  const plan = PLANS[i % PLANS.length];
  const expiry = new Date();
  expiry.setMonth(expiry.getMonth() + PLAN_MONTHS[plan]);
  // Spread some members into the past so auto-expiry / dues logic has cases.
  if (i % 5 === 0) expiry.setMonth(expiry.getMonth() - PLAN_MONTHS[plan] - 1);

  rows.push({
    full_name: name,
    mobile_number: testPhone(i),
    phone: testPhone(i),
    membership_plan: plan,
    expiry_date: expiry.toISOString(),
    status: i / COUNT <= ACTIVE_RATIO ? "Active" : "Pending",
    auth_user_id: null,
    gym_id: gym.id,
    gym_owner_id: gym.gym_owner_id,
  });
}

if (rows.length === 0) {
  console.log("✅ Nothing to insert — all requested TEST_ members already exist.");
  process.exit(0);
}

console.log(`🚀 Inserting ${rows.length} TEST_ members in batches of ${BATCH}…`);

let inserted = 0;
let failed = 0;
const startedAt = Date.now();

for (let start = 0; start < rows.length; start += BATCH) {
  const chunk = rows.slice(start, start + BATCH);
  const { data, error } = await supabase.from("members").insert(chunk).select("id");

  if (error) {
    failed += chunk.length;
    console.error(
      `  ✗ batch ${start / BATCH + 1} failed (${chunk.length} rows): ${error.message}`
    );
    // Keep going — a bad batch shouldn't abort the whole run.
    continue;
  }
  inserted += data?.length ?? chunk.length;
  const pct = Math.round((inserted / rows.length) * 100);
  console.log(
    `  ✓ batch ${start / BATCH + 1}: +${data?.length ?? chunk.length}  ` +
      `(${inserted}/${rows.length}, ${pct}%)`
  );
}

const secs = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log(
  `\n✅ Done. Inserted ${inserted}, failed ${failed}, in ${secs}s.\n` +
    `   Next: node scripts/scale-test/02-simulate-activity.mjs`
);
