# Gymphony — 500-Member Scale Validation Harness

Pure-DB load tooling for the owner dashboard. **No SMS / email / WhatsApp / n8n /
PhonePe fires** — those only run from explicit UI actions and the `send-invite`
edge function, none of which a raw insert can reach.

## Safety model
- All members are named `TEST_Member_NNNN` (prefix `TEST_`).
- Everything is scoped to `TEST_GYM_ID` — use a **throwaway / staging gym**, never a real one.
- Cleanup is **dry-run by default** and double-guarded (id set + `TEST_` name).
- Uses the **service-role** key (bypasses RLS) — keep it out of git/CI logs.

## Setup (PowerShell)
```powershell
$env:SUPABASE_URL = "https://<project>.supabase.co"   # or rely on VITE_SUPABASE_URL in .env
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role_key>"  # Supabase → Settings → API
$env:TEST_GYM_ID = "<gym_settings.id of a throwaway gym>"
```

## Run
```powershell
# Phase 2 — generate 500 members (batched, idempotent)
node scripts/scale-test/01-generate-members.mjs --count=500 --batch=50

# Phase 3 — exercise realtime for a subset (open the owner dashboard first!)
node scripts/scale-test/02-simulate-activity.mjs --subset=50 --live --delay=400   # watch live
node scripts/scale-test/02-simulate-activity.mjs --subset=50 --bulk               # DB load

# Phase 4 — cleanup
node scripts/scale-test/03-cleanup.mjs           # dry run (counts only)
node scripts/scale-test/03-cleanup.mjs --apply   # delete TEST_ rows
```

Runs under `node` (>=18) or `bun`. Depends only on `@supabase/supabase-js`
(already in devDependencies).

## What each event exercises
| Script event | Tables written | Realtime listeners hit |
|---|---|---|
| check-in | `check_ins`, `activity_log` | owner `dashboard_realtime_*` (check_ins gym_id + activity_log) , member dashboard |
| payment | `payments` | owner `fetchMembersCounts` refetch (revenue/dues), `OwnerPendingPayments` |
| membership update | `profiles` via `app_activate_member` RPC | owner profiles/members refetch, member `MemberActivePlans` |
