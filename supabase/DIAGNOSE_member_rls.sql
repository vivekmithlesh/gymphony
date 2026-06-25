-- =============================================================================
-- DIAGNOSE_member_rls.sql — READ-ONLY catalog inspection + post-apply verify.
-- Run in Supabase SQL Editor (service role). Nothing here changes data/schema.
-- =============================================================================

-- 1. RLS enabled? (profiles should be FALSE today → that's the breach.)
select relname, relrowsecurity, relforcerowsecurity
from pg_class
where relname in ('profiles','member_invites','activity_log','payments','check_ins');

-- 2. Existing policies.
select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where tablename in ('profiles','member_invites','activity_log','payments','check_ins')
order by tablename, policyname;

-- 3. Protective triggers (role / status-plan-expiry lockdown / member cap).
select tgname, tgrelid::regclass as table_name, tgenabled
from pg_trigger
where tgrelid::regclass::text in ('public.profiles','public.member_invites','public.payments','public.check_ins')
  and not tgisinternal
order by table_name, tgname;

-- 4. RPC security type (these MUST be DEFINER to work over RLS).
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in (
    'app_add_member_invite','app_claim_member_invite','app_request_gym_switch',
    'app_self_checkin','approve_payment','app_activate_member',
    'mark_notifications_read','app_caller_gym_id')
order by routine_name;

-- 5. Is the members view security_invoker? (NULL/false today = bypasses RLS = leak)
select c.relname, c.reloptions
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname='members';

-- =============================================================================
-- POST-APPLY VERIFY (run AFTER 20260711 + 20260712). All must hold:
--   • Query 1: profiles.relrowsecurity = true.
--   • Query 5: members.reloptions contains 'security_invoker=true'.
--   • As ANON (use the anon key against the REST API, NOT here):
--        GET /rest/v1/profiles?select=id  → []   (was a full dump)
--        GET /rest/v1/members?select=id   → []
--   • As an authenticated MEMBER (member JWT): selecting another member's row
--     returns nothing; selecting own row returns it.
--   • Owner Members list, member dashboard, leaderboard, check-in all still load.
-- =============================================================================
