-- =====================================================================
-- WAVE 0 — LIVE DB VERIFICATION (read-only)
-- =====================================================================
-- Purpose: confirm whether the entitlement / subscription-security /
-- leaderboard-gate layer (migrations 20260606–20260623) is ACTUALLY
-- applied to the live database. The application code assumes these
-- objects exist; if they do not, the security guarantees (plan-column
-- lockdown, member-limit enforcement, leaderboard gating, payment RLS)
-- are NOT in force in production regardless of what the code says.
--
-- HOW TO RUN
--   Supabase Studio → SQL Editor → paste & Run (safe; SELECT-only), OR
--   psql "$SUPABASE_DB_URL" -f supabase/VERIFY_entitlement_layer.sql
--
-- Every row returns status = 'OK' (present) or 'MISSING'. Any MISSING row
-- means the corresponding migration has not been applied — apply it (in
-- timestamp order) in a maintenance window before relying on it.
-- =====================================================================

with checks(kind, object_name, present) as (

  -- ---- gym_settings subscription columns (20260620) -------------------
  select 'column', 'gym_settings.plan_tier',      exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_settings' and column_name='plan_tier')
  union all select 'column', 'gym_settings.plan_status',   exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_settings' and column_name='plan_status')
  union all select 'column', 'gym_settings.trial_ends_at', exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_settings' and column_name='trial_ends_at')
  union all select 'column', 'gym_settings.billing_cycle', exists (select 1 from information_schema.columns where table_schema='public' and table_name='gym_settings' and column_name='billing_cycle')

  -- ---- plan-column lockdown (20260621) --------------------------------
  union all select 'trigger',  'trg_lock_plan_columns on gym_settings', exists (select 1 from pg_trigger where tgname='trg_lock_plan_columns' and not tgisinternal)
  union all select 'function', 'app_set_owner_plan',  exists (select 1 from pg_proc where proname='app_set_owner_plan')
  union all select 'function', 'app_start_owner_trial', exists (select 1 from pg_proc where proname='app_start_owner_trial')
  union all select 'function', 'ensure_gym_settings', exists (select 1 from pg_proc where proname='ensure_gym_settings')
  union all select 'function', 'can_add_member',      exists (select 1 from pg_proc where proname='can_add_member')
  union all select 'trigger',  'trg_enforce_member_limit on profiles', exists (select 1 from pg_trigger where tgname='trg_enforce_member_limit' and not tgisinternal)

  -- ---- membership column lockdown (20260607/20260613) -----------------
  union all select 'trigger',  'trg_lock_membership_cols on profiles', exists (select 1 from pg_trigger where tgname='trg_lock_membership_cols' and not tgisinternal)
  union all select 'function', 'app_activate_member', exists (select 1 from pg_proc where proname='app_activate_member')

  -- ---- payment verification (20260605/20260606) -----------------------
  union all select 'function', 'approve_payment',     exists (select 1 from pg_proc where proname='approve_payment')
  union all select 'function', 'reject_payment',      exists (select 1 from pg_proc where proname='reject_payment')
  union all select 'rls',      'payments RLS enabled', exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='payments' and c.relrowsecurity)

  -- ---- workout integrity (20260615) -----------------------------------
  union all select 'function', 'log_workout_session', exists (select 1 from pg_proc where proname='log_workout_session')
  union all select 'trigger',  'trg_guard_vibe_points on gym_profiles', exists (select 1 from pg_trigger where tgname='trg_guard_vibe_points' and not tgisinternal)

  -- ---- leaderboard plan gate (20260623) -------------------------------
  union all select 'function', 'get_city_gym_leaderboard', exists (select 1 from pg_proc where proname='get_city_gym_leaderboard')

  -- ---- notifications (20260624 — NEW in this change) ------------------
  union all select 'table',    'activity_log',          exists (select 1 from information_schema.tables  where table_schema='public' and table_name='activity_log')
  union all select 'column',   'activity_log.member_id', exists (select 1 from information_schema.columns where table_schema='public' and table_name='activity_log' and column_name='member_id')
  union all select 'rls',      'activity_log RLS enabled', exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='activity_log' and c.relrowsecurity)
  union all select 'function', 'mark_notifications_read', exists (select 1 from pg_proc where proname='mark_notifications_read')

  -- ---- QR security (20260625 — NEW in this change) --------------------
  -- (app_config is RLS-locked; this SELECT only resolves when run as an admin
  --  role such as the Supabase SQL editor — which is the intended way to run it.)
  union all select 'table',    'app_config',            exists (select 1 from information_schema.tables where table_schema='public' and table_name='app_config')
  union all select 'config',   'qr_signing_key seeded', exists (select 1 from public.app_config where key='qr_signing_key')
  union all select 'table',    'qr_scans',              exists (select 1 from information_schema.tables where table_schema='public' and table_name='qr_scans')
  union all select 'rls',      'qr_scans RLS enabled',  exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='qr_scans' and c.relrowsecurity)
  union all select 'function', 'mint_member_pass',      exists (select 1 from pg_proc where proname='mint_member_pass')
  union all select 'function', 'kiosk_check_in',        exists (select 1 from pg_proc where proname='kiosk_check_in')

  -- ---- Payment hardening (20260626 — NEW in this change) --------------
  union all select 'column',   'payments.utr',          exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='utr')
  union all select 'column',   'payments.evidence_url', exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='evidence_url')
  union all select 'index',    'payments_utr_unique_idx', exists (select 1 from pg_indexes where schemaname='public' and indexname='payments_utr_unique_idx')
  union all select 'table',    'payment_audit',         exists (select 1 from information_schema.tables where table_schema='public' and table_name='payment_audit')
  union all select 'trigger',  'trg_payment_audit on payments', exists (select 1 from pg_trigger where tgname='trg_payment_audit' and not tgisinternal)
  union all select 'config',   'mock_payments_enabled gate', exists (select 1 from public.app_config where key='mock_payments_enabled')
)
select
  kind,
  object_name,
  case when present then 'OK' else 'MISSING' end as status
from checks
order by present asc, kind, object_name;  -- MISSING rows surface first
