-- =============================================================================
-- 20260711 — EMERGENCY: stop anonymous PII dumping of profiles + members view.
-- -----------------------------------------------------------------------------
-- PROVEN P0 (probed live with the public anon key on 2026-06-26): an UNAUTH
-- client can read the ENTIRE `public.profiles` table (full_name, phone, email,
-- gym_id, status — all gyms) and the same data via the `public.members` VIEW
-- (the view runs as definer, so it bypasses RLS). The anon key ships in the
-- frontend bundle, so this is a public data breach.
--
-- This migration is the SAFE, IMMEDIATE containment: revoke read access from the
-- anon / public roles. NO app path reads profiles or members while logged out
-- (the public Join/Check-in/Discovery pages read only gym_settings + gym_plans),
-- so authenticated flows are unaffected. `authenticated` is (re)granted explicitly
-- so logged-in owners/members keep working exactly as today. SECURITY DEFINER
-- RPCs and the members view's own reads are unaffected (they run as the definer).
--
-- This does NOT yet fix authenticated cross-tenant reads — that's 20260712
-- (RLS + policies + security_invoker on the view). Apply THIS one first.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

revoke select on public.profiles from anon;
revoke select on public.profiles from public;
revoke select on public.members  from anon;
revoke select on public.members  from public;

-- Keep authenticated reads working (in case the grant above reached them via PUBLIC).
grant select on public.profiles to authenticated;
grant select on public.members  to authenticated;

commit;

notify pgrst, 'reload schema';
