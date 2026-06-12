// =============================================================================
// PHASE 4 — CLEANUP  (safe, dry-run by default)
// scale-test / 03-cleanup.mjs
// -----------------------------------------------------------------------------
// Deletes ONLY TEST_ records for TEST_GYM_ID. Double-guarded:
//   members must match  gym_id = TEST_GYM_ID  AND  member_name LIKE 'TEST_Member_%'
//
// Order matters — children before the parent profiles row:
//   1. check_ins        (by test member_id, scoped to gym_id)
//   2. payments         (by test member_id)
//   3. activity_log     (test rows only: description LIKE '%(scale test).' OR
//                        '%scale test%', scoped to this gym's owner)
//   4. profiles         (the base table behind the `members` view)
//
// DRY-RUN by default: prints counts, deletes nothing. Pass --apply to delete.
//
// Usage:
//   node scripts/scale-test/03-cleanup.mjs            # dry run (counts only)
//   node scripts/scale-test/03-cleanup.mjs --apply    # actually delete
// =============================================================================

import { supabase, resolveGym, parseFlags } from "./config.mjs";

const flags = parseFlags();
const APPLY = Boolean(flags.apply);

const gym = await resolveGym();
console.log(APPLY ? "⚠️  APPLY mode — rows WILL be deleted." : "🧪 DRY RUN — nothing will be deleted. Add --apply to delete.");

// 1. Resolve the exact set of test member ids (the only thing we ever delete).
const { data: testMembers, error: mErr } = await supabase
  .from("members")
  .select("id, member_name")
  .eq("gym_id", gym.id)
  .like("member_name", "TEST_Member_%");

if (mErr) {
  console.error("❌ Could not enumerate test members:", mErr.message);
  process.exit(1);
}
const ids = (testMembers ?? []).map((m) => m.id);
console.log(`\nFound ${ids.length} TEST_ members for gym ${gym.id}.`);
if (ids.length === 0) {
  console.log("✅ Nothing to clean up.");
  process.exit(0);
}

async function countOrDelete(label, table, build) {
  // build(query) applies the filters; we run a head-count first, then delete.
  const { count, error: cErr } = await build(
    supabase.from(table).select("*", { count: "exact", head: true })
  );
  if (cErr) {
    console.error(`  ✗ ${label}: count failed — ${cErr.message}`);
    return;
  }
  console.log(`  ${APPLY ? "deleting" : "would delete"} ${count ?? 0} rows from ${label}`);
  if (!APPLY || !count) return;

  const { error: dErr } = await build(supabase.from(table).delete());
  if (dErr) console.error(`  ✗ ${label}: delete failed — ${dErr.message}`);
  else console.log(`  ✓ ${label} cleared`);
}

// Chunk .in() filters to keep URLs/statements within limits.
function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

for (const idBatch of chunk(ids, 100)) {
  await countOrDelete("check_ins", "check_ins", (q) =>
    q.eq("gym_id", gym.id).in("member_id", idBatch)
  );
  await countOrDelete("payments", "payments", (q) => q.in("member_id", idBatch));
}

// Test-only activity rows written by 02-simulate-activity.mjs (scoped to owner).
await countOrDelete("activity_log (scale-test rows)", "activity_log", (q) =>
  q.eq("gym_owner_id", gym.gym_owner_id).like("description", "%(scale test).")
);

// Finally the members themselves — delete the BASE profiles rows (the view isn't
// directly deletable). Re-guarded by id set + name prefix.
for (const idBatch of chunk(ids, 100)) {
  await countOrDelete("profiles (TEST_ members)", "profiles", (q) =>
    q.in("id", idBatch).like("full_name", "TEST_Member_%")
  );
}

console.log(
  APPLY
    ? "\n✅ Cleanup complete. Re-run without --apply to confirm 0 remain."
    : "\n🧪 Dry run complete. Re-run with --apply to delete the above."
);
