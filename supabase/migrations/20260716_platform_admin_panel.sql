-- =============================================================================
-- 20260716 — Platform Super Admin panel: login tracking + admin analytics.
-- -----------------------------------------------------------------------------
-- Adds the data + security layer behind the /platform-admin dashboard:
--   1. is_platform_admin() — EXTENDED (additively) so the platform owner email
--      `abhishek0892008@gmail.com` is always an admin, on top of the existing
--      server-managed profiles.is_platform_admin flag (20260629). The email is
--      read from the VERIFIED JWT (auth.jwt() ->> 'email'), NEVER profiles.email
--      (which a user can edit — that would be a privilege-escalation hole).
--   2. app_login_events — append-only login audit. RLS: only a platform admin may
--      SELECT. No client INSERT policy → rows are written ONLY by the
--      SECURITY DEFINER app_log_login_event() RPC, which derives identity from
--      auth.uid()/JWT (the client cannot forge who logged in). No secrets stored.
--   3. Admin analytics RPCs (all is_platform_admin()-gated → raise 'not
--      authorized' for everyone else):
--        - app_admin_platform_stats()   → platform totals (jsonb)
--        - app_admin_list_gyms(int)     → gyms + subscription + member count
--        - app_admin_recent_logins(int) → recent login feed
--        - app_admin_gym_detail(uuid)   → single gym drill-down (jsonb)
--
-- Idempotent; safe to re-run. Depends on: is_platform_admin() (20260629),
-- gym_settings subscription columns (20260620/20260621), profiles, and
-- (optionally) subscription_payments (20260629) + international_payments (20260705).
-- =============================================================================

begin;

-- 1. Admin gate — flag (existing) OR the hardcoded platform-owner JWT email. ---
--    Keeping the flag means any admin already provisioned via SQL keeps working;
--    the email clause guarantees abhishek0892008@gmail.com is always admin
--    without a manual bootstrap step. Additive only → never removes access.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce((select is_platform_admin from public.profiles where id = auth.uid()), false)
    or lower(coalesce(auth.jwt() ->> 'email', '')) = 'abhishek0892008@gmail.com';
$$;
grant execute on function public.is_platform_admin() to authenticated;

-- gym_settings.created_at is needed for the "Gym created date" column. It almost
-- certainly already exists; add it idempotently so the RPCs below never break.
alter table public.gym_settings
  add column if not exists created_at timestamptz not null default now();

-- 2. Login audit table -------------------------------------------------------
create table if not exists public.app_login_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid,
  email      text,
  role       text,
  gym_id     uuid,
  gym_name   text,
  login_at   timestamptz not null default now(),
  user_agent text,
  device     text,
  status     text not null default 'success'
);

create index if not exists app_login_events_login_at_idx
  on public.app_login_events (login_at desc);
create index if not exists app_login_events_user_idx
  on public.app_login_events (user_id, login_at desc);

alter table public.app_login_events enable row level security;

-- Only a platform admin may read the login feed. There is intentionally NO
-- insert/update/delete policy: ordinary clients can never write or read others'
-- rows. Writes happen solely through the SECURITY DEFINER RPC below.
drop policy if exists login_events_admin_select on public.app_login_events;
create policy login_events_admin_select on public.app_login_events
  for select to authenticated
  using (public.is_platform_admin());

-- 3. Record a successful login -----------------------------------------------
--    Server-safe: identity (user_id/email/role/gym) is derived from auth.uid()
--    + the verified JWT + server tables, NOT from client input. The client only
--    supplies the non-sensitive user_agent/device strings. No passwords, tokens
--    or OTPs are ever accepted or stored. No-op for unauthenticated callers.
create or replace function public.app_log_login_event(
  p_user_agent text default null,
  p_device     text default null,
  p_status     text default 'success'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_email    text;
  v_role     text;
  v_gym_id   uuid;
  v_gym_name text;
begin
  if v_uid is null then
    return;  -- nothing to attribute a login to
  end if;

  v_email := coalesce(auth.jwt() ->> 'email',
                      (select email from public.profiles where id = v_uid));

  select p.role, p.gym_id into v_role, v_gym_id
  from public.profiles p where p.id = v_uid;

  -- Resolve the gym name: the member/owner's own gym, else the gym they own.
  if v_gym_id is not null then
    select gs.gym_name into v_gym_name from public.gym_settings gs where gs.id = v_gym_id;
  end if;
  if v_gym_name is null then
    select gs.gym_name into v_gym_name from public.gym_settings gs
    where gs.gym_owner_id = v_uid limit 1;
  end if;

  insert into public.app_login_events
    (user_id, email, role, gym_id, gym_name, user_agent, device, status)
  values
    (v_uid, v_email, v_role, v_gym_id, v_gym_name,
     nullif(btrim(coalesce(p_user_agent, '')), ''),
     nullif(btrim(coalesce(p_device, '')), ''),
     coalesce(nullif(btrim(coalesce(p_status, '')), ''), 'success'));
end;
$$;
grant execute on function public.app_log_login_event(text, text, text) to authenticated;

-- 4a. Platform totals --------------------------------------------------------
create or replace function public.app_admin_platform_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_pending_intl integer := 0;
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  -- International (Payoneer) pending payments — table may be absent in some envs.
  begin
    select count(*) into v_pending_intl
    from public.international_payments
    where status in ('pending', 'submitted');
  exception when undefined_table then
    v_pending_intl := 0;
  end;

  select jsonb_build_object(
    'total_gyms',   (select count(*) from public.gym_settings),
    'total_owners', (select count(distinct gym_owner_id) from public.gym_settings where gym_owner_id is not null),
    'total_members',(select count(*) from public.profiles where role = 'member'),
    'active_subscriptions', (
      select count(*) from public.gym_settings
      where plan_status = 'active' and (expiry_date is null or expiry_date > now())
    ),
    'trial_gyms', (
      select count(*) from public.gym_settings
      where plan_status = 'trial' and (trial_ends_at is null or trial_ends_at > now())
    ),
    'expired_subscriptions', (
      select count(*) from public.gym_settings
      where plan_status in ('expired', 'inactive')
         or (plan_status = 'active' and expiry_date is not null and expiry_date <= now())
         or (plan_status = 'trial'  and trial_ends_at is not null and trial_ends_at <= now())
    ),
    'pending_payments',
      (select count(*) from public.subscription_payments where status = 'pending_verification')
      + v_pending_intl
  ) into v_result;

  return v_result;
end;
$$;
grant execute on function public.app_admin_platform_stats() to authenticated;

-- 4b. Gyms + subscription + member count + last login ------------------------
create or replace function public.app_admin_list_gyms(p_limit integer default 500)
returns table (
  gym_id        uuid,
  gym_name      text,
  owner_id      uuid,
  owner_name    text,
  owner_email   text,
  plan_tier     text,
  plan_status   text,
  billing_cycle text,
  member_count  bigint,
  created_at    timestamptz,
  trial_ends_at timestamptz,
  expiry_date   timestamptz,
  last_login    timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
    select
      gs.id,
      coalesce(nullif(btrim(gs.gym_name), ''), 'Unnamed gym'),
      gs.gym_owner_id,
      op.full_name,
      coalesce(nullif(btrim(gs.owner_email), ''), op.email),
      gs.plan_tier,
      gs.plan_status,
      gs.billing_cycle,
      (select count(*) from public.profiles mp where mp.gym_id = gs.id and mp.role = 'member'),
      gs.created_at,
      gs.trial_ends_at,
      gs.expiry_date,
      (select max(le.login_at) from public.app_login_events le where le.user_id = gs.gym_owner_id)
    from public.gym_settings gs
    left join public.profiles op on op.id = gs.gym_owner_id
    order by gs.created_at desc nulls last
    limit greatest(coalesce(p_limit, 500), 0);
end;
$$;
grant execute on function public.app_admin_list_gyms(integer) to authenticated;

-- 4c. Recent login feed ------------------------------------------------------
create or replace function public.app_admin_recent_logins(p_limit integer default 100)
returns table (
  id         uuid,
  user_id    uuid,
  email      text,
  role       text,
  gym_id     uuid,
  gym_name   text,
  login_at   timestamptz,
  user_agent text,
  device     text,
  status     text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  return query
    select le.id, le.user_id, le.email, le.role, le.gym_id, le.gym_name,
           le.login_at, le.user_agent, le.device, le.status
    from public.app_login_events le
    order by le.login_at desc
    limit greatest(coalesce(p_limit, 100), 0);
end;
$$;
grant execute on function public.app_admin_recent_logins(integer) to authenticated;

-- 4d. Single-gym drill-down --------------------------------------------------
create or replace function public.app_admin_gym_detail(p_gym_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gs     record;
  v_logins jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select gs.*, op.full_name as owner_name, op.email as owner_profile_email
  into v_gs
  from public.gym_settings gs
  left join public.profiles op on op.id = gs.gym_owner_id
  where gs.id = p_gym_id;

  if not found then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'email', le.email, 'role', le.role, 'login_at', le.login_at,
        'device', le.device, 'user_agent', le.user_agent, 'status', le.status
      ) order by le.login_at desc
    ),
    '[]'::jsonb
  )
  into v_logins
  from public.app_login_events le
  where le.user_id = v_gs.gym_owner_id
  and le.login_at >= now() - interval '90 days';

  return jsonb_build_object(
    'gym_id',             v_gs.id,
    'gym_name',           coalesce(nullif(btrim(v_gs.gym_name), ''), 'Unnamed gym'),
    'owner_id',           v_gs.gym_owner_id,
    'owner_name',         v_gs.owner_name,
    'owner_email',        coalesce(nullif(btrim(v_gs.owner_email), ''), v_gs.owner_profile_email),
    'plan_tier',          v_gs.plan_tier,
    'plan_status',        v_gs.plan_status,
    'billing_cycle',      v_gs.billing_cycle,
    'member_count',       (select count(*) from public.profiles where gym_id = v_gs.id and role = 'member'),
    'created_at',         v_gs.created_at,
    'subscription_start', v_gs.subscription_start,
    'trial_ends_at',      v_gs.trial_ends_at,
    'expiry_date',        v_gs.expiry_date,
    'last_login',         (select max(login_at) from public.app_login_events where user_id = v_gs.gym_owner_id),
    'recent_logins',      v_logins
  );
end;
$$;
grant execute on function public.app_admin_gym_detail(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- Post-apply verification (Supabase SQL editor):
--   • As abhishek0892008@gmail.com:  select public.is_platform_admin();  → true
--   • As any other owner/member:     select public.is_platform_admin();  → false
--   • Non-admin calling app_admin_platform_stats() / app_admin_list_gyms() /
--     app_admin_recent_logins() / app_admin_gym_detail() → raises 'not authorized'.
--   • Non-admin: select * from public.app_login_events;  → 0 rows (RLS).
--   • After a real login the client calls app_log_login_event(...) → one row.
-- No bootstrap needed: the email is hardcoded into is_platform_admin(). Existing
-- flag-based admins (profiles.is_platform_admin = true) continue to work.
-- ============================================================================
