// =============================================================================
// scale-test / config.mjs  —  shared setup for the 500-member load harness
// -----------------------------------------------------------------------------
// Builds a SERVICE-ROLE Supabase client and resolves the target TEST gym.
//
// WHY service-role: the `members` view writes the base `profiles` table; profiles
// has broad grants but the membership-lockdown trigger (20260607) gates UPDATEs.
// We only INSERT here, and service-role keeps batches fast and RLS-independent.
//
// SAFETY GUARANTEES (read before running):
//   • Every member name is prefixed with TEST_  (see TEST_PREFIX).
//   • Everything is scoped to TEST_GYM_ID — nothing touches other gyms.
//   • Pure DB inserts. The only code that sends SMS / WhatsApp / email / n8n is
//     the send-invite edge function + the manual "Send Reminder" button + phonepe
//     — NONE of which is reachable from a raw insert. So NO real messages fire.
//
// REQUIRED ENV (export or put in a .env the script auto-loads):
//   SUPABASE_URL                (falls back to VITE_SUPABASE_URL in .env)
//   SUPABASE_SERVICE_ROLE_KEY   (NOT the anon key — get it from Supabase dashboard;
//                                never commit it)
//   TEST_GYM_ID                 gym_settings.id to attach the test members to.
//                               USE A THROWAWAY / STAGING GYM — not a real one.
// =============================================================================

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

// --- minimal .env loader (no extra deps) -------------------------------------
function loadEnvFile(name) {
  const p = resolve(repoRoot, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim().replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnvFile(".env");
loadEnvFile(".env.local");

export const TEST_PREFIX = "TEST_";

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
export const TEST_GYM_ID = process.env.TEST_GYM_ID;

function fail(msg) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

if (!SUPABASE_URL) fail("SUPABASE_URL (or VITE_SUPABASE_URL) is not set.");
if (!SERVICE_KEY) {
  fail(
    "SUPABASE_SERVICE_ROLE_KEY is not set.\n" +
      "   Get it from Supabase → Project Settings → API → service_role key.\n" +
      "   This key bypasses RLS — keep it out of git and CI logs."
  );
}
if (!TEST_GYM_ID) {
  fail(
    "TEST_GYM_ID is not set.\n" +
      "   Set it to the gym_settings.id of a THROWAWAY / staging gym.\n" +
      "   Example (PowerShell):  $env:TEST_GYM_ID = '00000000-...'"
  );
}

export const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Resolve the gym once so every script knows the owner id + coordinates.
export async function resolveGym() {
  const { data, error } = await supabase
    .from("gym_settings")
    .select("id, gym_name, gym_owner_id, latitude, longitude")
    .eq("id", TEST_GYM_ID)
    .maybeSingle();

  if (error) fail(`Could not read gym_settings: ${error.message}`);
  if (!data) fail(`No gym_settings row with id=${TEST_GYM_ID}. Create the test gym first.`);

  console.log(
    `🏋️  Target gym: "${data.gym_name}"  (id=${data.id})  owner=${data.gym_owner_id}`
  );
  return data;
}

// Deterministic, clearly-fake E.164 phone — never a real reachable number, and
// raw inserts send nothing anyway. Range +91 90000XXXXX.
export const testPhone = (i) =>
  "+9190000" + String(i).padStart(5, "0").slice(-5);

export const testName = (i) => `${TEST_PREFIX}Member_${String(i).padStart(4, "0")}`;

// Simple async pool so we never blast hundreds of concurrent requests.
export async function runPool(items, concurrency, worker) {
  let idx = 0;
  const results = [];
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const myIdx = idx++;
      results[myIdx] = await worker(items[myIdx], myIdx);
    }
  });
  await Promise.all(runners);
  return results;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseFlags() {
  const flags = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) flags[m[1]] = m[2] === undefined ? true : m[2];
  }
  return flags;
}
