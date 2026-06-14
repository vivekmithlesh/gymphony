-- ============================================================================
-- 20260621_subscription_security.sql
-- P0 launch-blocker fixes for the owner SaaS subscription system:
--   (1) Lock down gym_settings plan columns  — owners can no longer self-grant
--       a plan from the client; only verified server paths may write them.
--   (2) ensure_gym_settings()                — guarantees a per-owner gym row +
--       7-day trial at signup (also fixes the shared-gym_id tenancy bug).
--   (3) Server-side member-limit enforcement — Starter 100 / Growth 500 / Pro ∞,
--       enforced in the database, not just the client.
--
-- Mirrors the membership-column lockdown pattern in 20260607: a transaction-local
-- GUC flag set ONLY inside SECURITY DEFINER functions; PostgREST clients cannot
-- issue a bare SET, so the flag can't be spoofed.
--
-- Apply AFTER 20260620_subscription_plans. Idempotent; safe to re-run.
-- ============================================================================

begin;

-- ===========================================================================
-- (1) gym_settings PLAN-COLUMN LOCKDOWN
-- ---------------------------------------------------------------------------
-- The hole: gym_settings has owner UPDATE RLS, so a gym owner could run
--   supabase.from('gym_settings').update({plan_tier:'pro', plan_status:'active',
--                                          expiry_date:'2099-01-01'})
-- from the browser console and self-grant Pro forever. There was NO guard on
-- these columns (the 20260607 lockdown only covered profiles membership cols).
--
-- Fix: a BEFORE UPDATE trigger that rejects any change to the protected plan
-- columns unless app.allow_plan_write is set — which only our SECURITY DEFINER
-- writers do. Non-plan settings edits (gym_name, hours, logo, …) pass through.
-- ===========================================================================

-- Authorized writer used by the verified payment webhook (service role) to set
-- a paid subscription. Sets the allow flag, then writes the plan columns.
create or replace function public.app_set_owner_plan(
  p_owner    uuid,
  p_tier     text,
  p_status   text default 'active',
  p_cycle    text default 'monthly',
  p_expiry   timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_tier not in ('starter','growth','pro') then
    raise exception 'invalid plan tier %', p_tier using errcode = 'check_violation';
  end if;

  perform set_config('app.allow_plan_write', 'on', true);

  update public.gym_settings
     set plan_tier          = p_tier,
         plan_type          = initcap(p_tier),         -- legacy mirror
         plan_status        = coalesce(p_status, 'active'),
         billing_cycle      = coalesce(p_cycle, 'monthly'),
         subscription_start = now(),
         expiry_date        = coalesce(
                                 p_expiry,
                                 now() + case when p_cycle = 'yearly'
                                              then interval '1 year'
                                              else interval '1 month' end),
         trial_ends_at      = null
   where gym_owner_id = p_owner;
end;
$$;

-- One-time trial starter for the authenticated owner. Abuse-resistant: only
-- grants a trial if the gym has NEVER had one (trial_ends_at is null) and isn't
-- already on a paid plan — so a returning user can't reset their trial.
create or replace function public.app_start_owner_trial()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('app.allow_plan_write', 'on', true);

  update public.gym_settings
     set plan_tier     = 'growth',
         plan_status   = 'trial',
         trial_ends_at = now() + interval '7 days',
         billing_cycle = 'monthly'
   where gym_owner_id = v_owner
     and trial_ends_at is null
     and coalesce(plan_status, '') <> 'active';
end;
$$;

-- The lockdown trigger. Only raises when a protected column actually changes
-- AND the allow flag is not set — so ordinary settings updates are untouched.
create or replace function public.app_lock_plan_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  protected text[] := array[
    'plan_tier','plan_type','plan_status',
    'trial_ends_at','subscription_start','expiry_date','billing_cycle'
  ];
  col       text;
  newj      jsonb := to_jsonb(new);
  oldj      jsonb := to_jsonb(old);
  v_changed boolean := false;
begin
  -- Authorized server path (app_set_owner_plan / app_start_owner_trial / webhook).
  if coalesce(current_setting('app.allow_plan_write', true), '') = 'on' then
    return new;
  end if;

  foreach col in array protected loop
    if (newj ? col) and ((newj->>col) is distinct from (oldj->>col)) then
      v_changed := true;
      exit;
    end if;
  end loop;

  if not v_changed then
    return new; -- plain settings edit (name/hours/logo/etc.)
  end if;

  raise exception
    'Subscription plan can only be changed by a verified payment, not directly.'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists trg_lock_plan_columns on public.gym_settings;
create trigger trg_lock_plan_columns
  before update on public.gym_settings
  for each row execute function public.app_lock_plan_columns();

-- The webhook writer must NOT be callable by end users; only the service role
-- (used by the edge function) may invoke it. The trial starter is safe for owners.
revoke all on function public.app_set_owner_plan(uuid, text, text, text, timestamptz) from public, anon, authenticated;
-- The verified webhook (razorpay-webhook) calls this with the service role.
grant execute on function public.app_set_owner_plan(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.app_start_owner_trial() to authenticated;

-- ===========================================================================
-- (2) ensure_gym_settings() — per-owner row + trial at signup
-- ---------------------------------------------------------------------------
-- Signup never created a gym_settings row and reused a hardcoded gym_id for all
-- owners. This SECURITY DEFINER RPC creates (idempotently) a row keyed by a
-- FRESH per-gym uuid for the authenticated owner; the 20260620 BEFORE INSERT
-- trigger then stamps the 7-day trial. Returns the gym id so the client can use
-- it as profiles.gym_id (real tenant isolation).
-- ===========================================================================
create or replace function public.ensure_gym_settings(
  p_gym_id   uuid default null,
  p_gym_name text default null,
  p_email    text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_id    uuid;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  select id into v_id from public.gym_settings where gym_owner_id = v_owner limit 1;
  if v_id is not null then
    return v_id; -- already provisioned (idempotent)
  end if;

  -- INSERT is not covered by the plan-column lockdown (that trigger is UPDATE-only),
  -- and trg_start_trial_on_gym_insert (20260620) sets the trial fields here.
  -- Use the client-supplied id when given so profiles.gym_id matches exactly.
  insert into public.gym_settings (id, gym_owner_id, gym_name, owner_email)
  values (coalesce(p_gym_id, gen_random_uuid()), v_owner,
          coalesce(nullif(p_gym_name,''), 'My Gym'), p_email)
  returning id into v_id;

  return v_id;
end;
$$;

grant execute on function public.ensure_gym_settings(uuid, text, text) to authenticated;

-- ===========================================================================
-- (3) SERVER-SIDE MEMBER-LIMIT ENFORCEMENT
-- ---------------------------------------------------------------------------
-- `members` is a VIEW over `profiles`, so the base table profiles is the single
-- chokepoint for EVERY member-creation path (owner add, bulk import, self-serve
-- join). A BEFORE INSERT trigger rejects the insert once the gym is at its cap.
-- Owners' own profile rows and rows with no gym are never counted/limited.
-- ===========================================================================

-- Recount excluding the owner's own profile (role 'owner').
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
  if p_gym_id is null then
    return true;
  end if;
  v_limit := public.fn_owner_member_limit(p_gym_id);
  if v_limit is null then
    return true; -- unlimited (Pro)
  end if;
  select count(*) into v_count
    from public.profiles
   where gym_id = p_gym_id
     and coalesce(role, 'member') <> 'owner';
  return v_count < v_limit;
end;
$$;

create or replace function public.fn_enforce_member_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Skip owner rows and rows not attached to a gym.
  if new.gym_id is null or coalesce(new.role, 'member') = 'owner' then
    return new;
  end if;
  if not public.can_add_member(new.gym_id) then
    raise exception 'PLAN_MEMBER_LIMIT_REACHED'
      using hint = 'This gym has reached its plan member limit. Upgrade the plan to add more members.',
            errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_member_limit on public.profiles;
create trigger trg_enforce_member_limit
  before insert on public.profiles
  for each row execute function public.fn_enforce_member_limit();

grant execute on function public.can_add_member(uuid) to authenticated;

commit;

-- ============================================================================
-- Post-apply verification (run in the SQL editor as an authenticated owner /
-- via the service role — see the accompanying test harness):
--   • UPDATE gym_settings SET plan_tier='pro' …    → must RAISE check_violation
--   • SELECT ensure_gym_settings('X','e@x.com')     → returns a uuid, row on trial
--   • INSERT 101st member profile on Starter        → must RAISE PLAN_MEMBER_LIMIT_REACHED
-- ============================================================================
