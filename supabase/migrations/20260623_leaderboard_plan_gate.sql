-- =============================================================================
-- Gate the city leaderboard behind the GROWTH tier — SERVER-SIDE.
--
-- Frontend gating (nav lock + route guard) is UX only. This is the real
-- security boundary: get_city_gym_leaderboard now resolves the caller's gym
-- plan and raises insufficient_privilege (SQLSTATE 42501 → PostgREST 403) when
-- the effective tier is below Growth. Trial windows count as Growth, mirroring
-- resolveSubscription() in src/lib/plans.ts.
--
-- The RETURN SHAPE is unchanged from 20260607; only access control + language
-- (sql → plpgsql, to host the check) change. Idempotent.
-- =============================================================================

drop function if exists public.get_city_gym_leaderboard(text);

create or replace function public.get_city_gym_leaderboard(p_city text default 'ALIGARH')
returns table (
  gym_id           uuid,
  gym_name         text,
  city             text,
  latitude         numeric,
  longitude        numeric,
  logo_url         text,
  monthly_calories numeric,
  active_members   bigint,
  monthly_checkins bigint,
  is_active        boolean
)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid        uuid := auth.uid();
  v_plan_tier  text;
  v_status     text;
  v_trial_ends timestamptz;
  v_expiry     timestamptz;
  v_tier       text;
  v_rank       int;
begin
  -- Must be an authenticated gym owner.
  if v_uid is null then
    raise exception 'leaderboard_requires_growth'
      using errcode = '42501', hint = 'Upgrade to Growth to access the leaderboard.';
  end if;

  select s.plan_tier, s.plan_status, s.trial_ends_at, s.expiry_date
    into v_plan_tier, v_status, v_trial_ends, v_expiry
  from public.gym_settings s
  where s.gym_owner_id = v_uid
  limit 1;

  -- Resolve the EFFECTIVE tier (mirror of resolveSubscription):
  --   active trial            -> growth
  --   active & not expired     -> the paid tier
  --   anything else            -> starter
  if v_trial_ends is not null and v_trial_ends > now()
       and lower(coalesce(v_status, '')) <> 'active' then
    v_tier := 'growth';
  elsif lower(coalesce(v_status, '')) = 'active'
       and (v_expiry is null or v_expiry > now()) then
    v_tier := lower(coalesce(v_plan_tier, 'starter'));
  else
    v_tier := 'starter';
  end if;

  v_rank := case v_tier when 'pro' then 3 when 'growth' then 2 else 1 end;

  -- Growth (rank 2) or higher required.
  if v_rank < 2 then
    raise exception 'leaderboard_requires_growth'
      using errcode = '42501', hint = 'Upgrade to Growth to access the leaderboard.';
  end if;

  return query
  with month_start as (select date_trunc('month', now()) as ts)
  select
    g.id                                          as gym_id,
    coalesce(g.gym_name, 'Unknown Gym')           as gym_name,
    coalesce(nullif(trim(g.city), ''), 'ALIGARH') as city,
    g.latitude::numeric                           as latitude,
    g.longitude::numeric                          as longitude,
    g.logo_url                                    as logo_url,
    coalesce((
      select sum(w.calories_burned)::numeric
      from public.workout_logs w, month_start ms
      where w.gym_id = g.id and w.created_at >= ms.ts
    ), 0)                                         as monthly_calories,
    coalesce((
      select count(*)
      from public.members m
      where m.gym_id = g.id and lower(coalesce(m.status, '')) = 'active'
    ), 0)                                         as active_members,
    coalesce((
      select count(*)
      from public.check_ins c, month_start ms
      where c.gym_id = g.id and c.check_in_time >= ms.ts
    ), 0)                                         as monthly_checkins,
    exists (
      select 1 from public.workout_logs w
      where w.gym_id = g.id and w.created_at >= now() - interval '12 minutes'
    )                                             as is_active
  from public.gym_settings g
  where upper(coalesce(nullif(trim(g.city), ''), 'ALIGARH'))
        = upper(coalesce(nullif(trim(p_city), ''), 'ALIGARH'))
  order by monthly_calories desc, gym_name asc;
end;
$$;

-- Authenticated owners only — the gate needs auth.uid(); anon can never qualify.
revoke all on function public.get_city_gym_leaderboard(text) from public;
revoke execute on function public.get_city_gym_leaderboard(text) from anon;
grant execute on function public.get_city_gym_leaderboard(text) to authenticated;
