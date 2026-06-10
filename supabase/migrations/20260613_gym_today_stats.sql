-- =============================================================================
-- Gym profile "live today" stats for /gym-detail.
-- -----------------------------------------------------------------------------
-- The public Gym Profile page shows three live counters — Total Calories,
-- Active Today and Members Logged In — for TODAY. The underlying workout_logs /
-- check_ins tables are RLS-scoped per gym, so a visitor (or a member of another
-- gym) can't read them directly. This SECURITY DEFINER function returns only
-- AGGREGATES (no member PII), exactly like get_city_gym_leaderboard, so any
-- viewer gets accurate counts that the client keeps live via realtime + polling.
--
--   today_calories    — sum of calories_burned logged today
--   active_today      — distinct members who logged a workout today
--   members_logged_in — distinct members who checked in today
--
-- "Today" is the local-server day (date_trunc('day', now())), matching the
-- member dashboard's start-of-day boundary. Idempotent; safe to re-run.
-- =============================================================================

drop function if exists public.get_gym_today_stats(uuid);

create or replace function public.get_gym_today_stats(p_gym uuid)
returns table (
  today_calories    numeric,
  active_today      bigint,
  members_logged_in bigint
)
language sql
security definer
set search_path = public
stable
as $$
  with day_start as (select date_trunc('day', now()) as ts)
  select
    coalesce((
      select sum(w.calories_burned)::numeric
      from public.workout_logs w, day_start d
      where w.gym_id = p_gym and w.created_at >= d.ts
    ), 0)                                              as today_calories,
    coalesce((
      select count(distinct coalesce(w.member_id, w.user_id))
      from public.workout_logs w, day_start d
      where w.gym_id = p_gym and w.created_at >= d.ts
    ), 0)                                              as active_today,
    coalesce((
      select count(distinct c.member_id)
      from public.check_ins c, day_start d
      where c.gym_id = p_gym and c.check_in_time >= d.ts
    ), 0)                                              as members_logged_in;
$$;

revoke all on function public.get_gym_today_stats(uuid) from public;
grant execute on function public.get_gym_today_stats(uuid) to authenticated, anon;
