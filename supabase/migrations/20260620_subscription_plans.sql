-- ============================================================================
-- 20260620_subscription_plans.sql
-- Owner SaaS subscription tiers: Starter / Growth / Pro + 7-day free trial.
--
-- This is the database half of the centralized plan system. The single source
-- of truth for prices, member limits and feature flags lives in the app at
-- src/lib/plans.ts — keep the member-limit mapping in fn_owner_member_limit()
-- below in sync with PLANS[*].memberLimit there.
--
-- IMPORTANT: gym_settings holds the GYM OWNER's SaaS subscription. It is a
-- different concept from a member's gym membership (profiles.subscription_*).
-- Idempotent — safe to re-run. Pre-launch: existing rows are seeded onto a
-- fresh 7-day trial.
-- ============================================================================

-- 1. Subscription columns on gym_settings ------------------------------------
--    plan_tier   : 'starter' | 'growth' | 'pro'  (effective paid tier)
--    plan_status : 'trial' | 'active' | 'expired' | 'inactive'
--    trial_ends_at / subscription_start / expiry_date : lifecycle timestamps
--    billing_cycle : 'monthly' | 'yearly'
--    plan_type   : LEGACY 'Free'/'Pro' column — retained for back-compat reads.
--    NOTE: plan_tier holds a *paid tier* ('starter'|'growth'|'pro'); the trial
--    state lives in plan_status, NOT plan_tier. So plan_tier defaults to
--    'starter' (a valid tier) and plan_status defaults to 'trial'.
alter table public.gym_settings add column if not exists plan_type          text;
alter table public.gym_settings add column if not exists plan_tier          text    not null default 'starter';
alter table public.gym_settings add column if not exists plan_status        text    not null default 'trial';
alter table public.gym_settings add column if not exists trial_ends_at      timestamptz;
alter table public.gym_settings add column if not exists subscription_start timestamptz;
alter table public.gym_settings add column if not exists expiry_date        timestamptz;
alter table public.gym_settings add column if not exists billing_cycle      text    not null default 'monthly';

-- Force-correct the defaults too, in case an earlier run created the columns
-- with a different default (e.g. plan_tier default 'trial').
alter table public.gym_settings alter column plan_tier     set default 'starter';
alter table public.gym_settings alter column plan_status   set default 'trial';
alter table public.gym_settings alter column billing_cycle set default 'monthly';

-- Sanitize any out-of-domain values BEFORE adding the check constraints, so the
-- constraints validate cleanly (a prior failed run may have left plan_tier='trial').
update public.gym_settings set plan_tier = 'starter'
  where plan_tier is null or plan_tier not in ('starter','growth','pro');
update public.gym_settings set plan_status = 'trial'
  where plan_status is null or plan_status not in ('trial','active','expired','inactive');
update public.gym_settings set billing_cycle = 'monthly'
  where billing_cycle is null or billing_cycle not in ('monthly','yearly');

-- Constrain the enumerated columns (drop-then-add so the migration is re-runnable).
alter table public.gym_settings drop constraint if exists gym_settings_plan_tier_chk;
alter table public.gym_settings add  constraint gym_settings_plan_tier_chk
  check (plan_tier in ('starter','growth','pro'));

alter table public.gym_settings drop constraint if exists gym_settings_plan_status_chk;
alter table public.gym_settings add  constraint gym_settings_plan_status_chk
  check (plan_status in ('trial','active','expired','inactive'));

alter table public.gym_settings drop constraint if exists gym_settings_billing_cycle_chk;
alter table public.gym_settings add  constraint gym_settings_billing_cycle_chk
  check (billing_cycle in ('monthly','yearly'));

-- 2. Backfill existing gyms (pre-launch) -------------------------------------
--    Map any legacy 'Pro' onto the new 'pro' tier as active; everyone else
--    starts a fresh 7-day trial (full Growth access) from now.
update public.gym_settings
set plan_tier   = 'pro',
    plan_status = 'active',
    expiry_date = coalesce(expiry_date, now() + interval '30 days')
where lower(coalesce(plan_type, '')) = 'pro'
  and plan_status is distinct from 'active';

update public.gym_settings
set plan_tier     = 'growth',
    plan_status   = 'trial',
    trial_ends_at = coalesce(trial_ends_at, now() + interval '7 days')
where lower(coalesce(plan_type, '')) <> 'pro'
  and (plan_status is null or plan_status = 'trial')
  and trial_ends_at is null;

-- 3. Auto-start a 7-day trial on new gyms ------------------------------------
create or replace function public.fn_start_trial_on_gym_insert()
returns trigger
language plpgsql
as $$
begin
  if new.trial_ends_at is null
     and (new.plan_status is null or new.plan_status = 'trial') then
    new.plan_tier     := coalesce(new.plan_tier, 'growth');
    new.plan_status   := 'trial';
    new.trial_ends_at := now() + interval '7 days';
    new.billing_cycle := coalesce(new.billing_cycle, 'monthly');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_start_trial_on_gym_insert on public.gym_settings;
create trigger trg_start_trial_on_gym_insert
  before insert on public.gym_settings
  for each row execute function public.fn_start_trial_on_gym_insert();

-- 4. Server-side member-limit helpers (defense in depth) ---------------------
--    The app enforces limits client-side from src/lib/plans.ts; these let the
--    backend confirm independently. Keep the mapping in sync with plans.ts.
create or replace function public.fn_owner_member_limit(p_gym_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  -- Resolve the effective tier (trial => growth) then map to a cap.
  -- Returns NULL for "unlimited" (Pro).
  select case
    when gs.plan_status = 'trial' and gs.trial_ends_at > now() then 500   -- trial = Growth
    when gs.plan_status = 'active' and gs.plan_tier = 'pro'     then null  -- unlimited
    when gs.plan_status = 'active' and gs.plan_tier = 'growth'  then 500
    when gs.plan_status = 'active' and gs.plan_tier = 'starter' then 100
    else 100                                                               -- expired/inactive => Starter
  end
  from public.gym_settings gs
  where gs.id = p_gym_id;
$$;

-- can_add_member(gym) — true when below the cap (or unlimited). Callable by the
-- client before inserting, and reusable in an enforcement trigger if desired.
create or replace function public.can_add_member(p_gym_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer;
  v_count integer;
begin
  v_limit := public.fn_owner_member_limit(p_gym_id);
  if v_limit is null then
    return true; -- unlimited (Pro)
  end if;
  select count(*) into v_count from public.profiles where gym_id = p_gym_id;
  return v_count < v_limit;
end;
$$;

grant execute on function public.fn_owner_member_limit(uuid) to authenticated;
grant execute on function public.can_add_member(uuid)        to authenticated;

-- OPTIONAL hard enforcement (left commented to keep member-creation flows safe;
-- enable only after verifying the members/profiles insert paths in staging):
--
-- create or replace function public.fn_enforce_member_limit()
-- returns trigger language plpgsql security definer set search_path = public as $$
-- begin
--   if not public.can_add_member(new.gym_id) then
--     raise exception 'PLAN_MEMBER_LIMIT_REACHED'
--       using hint = 'Upgrade the gym plan to add more members.';
--   end if;
--   return new;
-- end; $$;
--
-- drop trigger if exists trg_enforce_member_limit on public.profiles;
-- create trigger trg_enforce_member_limit
--   before insert on public.profiles
--   for each row execute function public.fn_enforce_member_limit();

-- ============================================================================
-- Notes
-- • RLS: gym_settings is already owner-scoped; the new columns inherit existing
--   policies. Owners update their own subscription row (as the upgrade flow
--   already does). No new policy required.
-- • To wire a real payment gateway, replace the mock in src/lib/phonepe.ts and
--   write plan_tier/billing_cycle/expiry_date from the verified webhook instead
--   of the client.
-- ============================================================================
