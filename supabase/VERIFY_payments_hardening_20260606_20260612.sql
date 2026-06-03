-- =============================================================================
-- VERIFY: are migrations 20260606–20260612 applied to the live DB?
-- -----------------------------------------------------------------------------
-- Read-only. Paste into the Supabase SQL editor and Run. Each row is one object
-- a migration is supposed to create; STATUS = OK means it's live, MISSING means
-- that migration hasn't been applied (or only partially).
--
-- If any row is MISSING: open the matching file in supabase/migrations/ and run
-- it (they are all idempotent / "safe to re-run"), in ascending order, then run:
--     notify pgrst, 'reload schema';
-- so PostgREST picks up new RPCs (otherwise the app gets HTTP 404 / PGRST202
-- on a freshly-created function until the cache reloads).
--
-- The one INVERTED check: 20260608 DROPS the instant-purchase backdoor
-- process_store_purchase — there, OK means "correctly absent".
-- =============================================================================

with checks as (

  -- ── 20260606_payments_rls ────────────────────────────────────────────────
  select '20260606' as migration, 'column'   as kind, 'payments.gym_id' as object,
         (exists (select 1 from information_schema.columns
                  where table_schema='public' and table_name='payments' and column_name='gym_id')) as ok
  union all select '20260606','column','payments.plan_name',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='payments' and column_name='plan_name')
  union all select '20260606','column','payments.payment_date',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='payments' and column_name='payment_date')
  union all select '20260606','function','app_fill_payment_owner()',
         to_regprocedure('public.app_fill_payment_owner()') is not null
  union all select '20260606','trigger','payments.trg_fill_payment_owner',
         exists (select 1 from pg_trigger where not tgisinternal
                 and tgname='trg_fill_payment_owner' and tgrelid='public.payments'::regclass)
  union all select '20260606','rls','payments row level security enabled',
         coalesce((select relrowsecurity from pg_class where oid='public.payments'::regclass), false)
  union all select '20260606','policy','payments_member_select',
         exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_member_select')
  union all select '20260606','policy','payments_member_insert',
         exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_member_insert')
  union all select '20260606','policy','payments_owner_all',
         exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_owner_all')

  -- ── 20260607_membership_column_lockdown ──────────────────────────────────
  union all select '20260607','function','app_activate_member(uuid,text,timestamptz)',
         to_regprocedure('public.app_activate_member(uuid, text, timestamptz)') is not null
  union all select '20260607','function','app_lock_membership_columns()',
         to_regprocedure('public.app_lock_membership_columns()') is not null
  union all select '20260607','function','approve_payment(uuid)',
         to_regprocedure('public.approve_payment(uuid)') is not null
  union all select '20260607','trigger','profiles.trg_lock_membership_cols',
         exists (select 1 from pg_trigger where not tgisinternal
                 and tgname='trg_lock_membership_cols' and tgrelid='public.profiles'::regclass)

  -- ── 20260608_store_upi_payments ──────────────────────────────────────────
  union all select '20260608','column','purchases.status',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='purchases' and column_name='status')
  union all select '20260608','column','purchases.payment_method',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='purchases' and column_name='payment_method')
  union all select '20260608','column','purchases.payment_date',
         exists (select 1 from information_schema.columns
                 where table_schema='public' and table_name='purchases' and column_name='payment_date')
  union all select '20260608','function','initiate_store_purchase(uuid,integer)',
         to_regprocedure('public.initiate_store_purchase(uuid, integer)') is not null
  union all select '20260608','function','approve_store_purchase(uuid)',
         to_regprocedure('public.approve_store_purchase(uuid)') is not null
  union all select '20260608','function','reject_store_purchase(uuid)',
         to_regprocedure('public.reject_store_purchase(uuid)') is not null
  -- INVERTED: the instant-purchase backdoor must be GONE.
  union all select '20260608','dropped','process_store_purchase(uuid,integer) absent',
         to_regprocedure('public.process_store_purchase(uuid, integer)') is null

  -- ── 20260609_cancel_store_purchase ───────────────────────────────────────
  union all select '20260609','function','cancel_store_purchase(uuid)',
         to_regprocedure('public.cancel_store_purchase(uuid)') is not null

  -- ── 20260610_expire_stale_store_purchases ────────────────────────────────
  union all select '20260610','function','expire_stale_store_purchases(integer)',
         to_regprocedure('public.expire_stale_store_purchases(integer)') is not null

  -- ── 20260611_expire_overdue_members ──────────────────────────────────────
  union all select '20260611','function','expire_overdue_members()',
         to_regprocedure('public.expire_overdue_members()') is not null

  -- ── 20260612_sync_member_amount_paid ─────────────────────────────────────
  union all select '20260612','function','app_sync_member_amount_paid(uuid)',
         to_regprocedure('public.app_sync_member_amount_paid(uuid)') is not null
  union all select '20260612','function','app_payments_resync_amount_paid()',
         to_regprocedure('public.app_payments_resync_amount_paid()') is not null
  union all select '20260612','trigger','payments.trg_payments_resync_amount_paid',
         exists (select 1 from pg_trigger where not tgisinternal
                 and tgname='trg_payments_resync_amount_paid' and tgrelid='public.payments'::regclass)
)
select
  migration,
  kind,
  object,
  case when ok then 'OK' else 'MISSING' end as status
from checks
order by migration, kind, object;

-- -----------------------------------------------------------------------------
-- Quick roll-up: one row per migration with a present/expected count. Anything
-- where present < expected means that migration needs (re-)running.
-- -----------------------------------------------------------------------------
-- (Re-run the same CTE for a summary; harmless to run together.)
with checks as (
  select '20260606' as migration, (exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='gym_id')) as ok
  union all select '20260606', exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='plan_name')
  union all select '20260606', exists (select 1 from information_schema.columns where table_schema='public' and table_name='payments' and column_name='payment_date')
  union all select '20260606', to_regprocedure('public.app_fill_payment_owner()') is not null
  union all select '20260606', exists (select 1 from pg_trigger where not tgisinternal and tgname='trg_fill_payment_owner' and tgrelid='public.payments'::regclass)
  union all select '20260606', coalesce((select relrowsecurity from pg_class where oid='public.payments'::regclass), false)
  union all select '20260606', exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_member_select')
  union all select '20260606', exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_member_insert')
  union all select '20260606', exists (select 1 from pg_policies where schemaname='public' and tablename='payments' and policyname='payments_owner_all')
  union all select '20260607', to_regprocedure('public.app_activate_member(uuid, text, timestamptz)') is not null
  union all select '20260607', to_regprocedure('public.app_lock_membership_columns()') is not null
  union all select '20260607', to_regprocedure('public.approve_payment(uuid)') is not null
  union all select '20260607', exists (select 1 from pg_trigger where not tgisinternal and tgname='trg_lock_membership_cols' and tgrelid='public.profiles'::regclass)
  union all select '20260608', exists (select 1 from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='status')
  union all select '20260608', exists (select 1 from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='payment_method')
  union all select '20260608', exists (select 1 from information_schema.columns where table_schema='public' and table_name='purchases' and column_name='payment_date')
  union all select '20260608', to_regprocedure('public.initiate_store_purchase(uuid, integer)') is not null
  union all select '20260608', to_regprocedure('public.approve_store_purchase(uuid)') is not null
  union all select '20260608', to_regprocedure('public.reject_store_purchase(uuid)') is not null
  union all select '20260608', to_regprocedure('public.process_store_purchase(uuid, integer)') is null
  union all select '20260609', to_regprocedure('public.cancel_store_purchase(uuid)') is not null
  union all select '20260610', to_regprocedure('public.expire_stale_store_purchases(integer)') is not null
  union all select '20260611', to_regprocedure('public.expire_overdue_members()') is not null
  union all select '20260612', to_regprocedure('public.app_sync_member_amount_paid(uuid)') is not null
  union all select '20260612', to_regprocedure('public.app_payments_resync_amount_paid()') is not null
  union all select '20260612', exists (select 1 from pg_trigger where not tgisinternal and tgname='trg_payments_resync_amount_paid' and tgrelid='public.payments'::regclass)
)
select
  migration,
  count(*) filter (where ok) as present,
  count(*)                   as expected,
  case when count(*) filter (where ok) = count(*) then 'APPLIED ✅' else 'NEEDS RUN ⚠️' end as verdict
from checks
group by migration
order by migration;
