-- =============================================================================
-- City gym leaderboard — "Calorie Burnout" ranking (Step 1).
-- Ranks every gym in a city by Total Calories Burned by its members THIS MONTH,
-- with active-member and monthly check-in counts for the map popup cards.
--
-- SECURITY DEFINER: a public leaderboard must read across gyms (workout_logs /
-- check_ins are RLS-scoped per gym), but it only ever returns AGGREGATES — no
-- member PII leaks. Canonical gym entity is public.gym_settings.
-- Idempotent; safe to re-run.
-- =============================================================================

-- Return signature changed (added is_active) → drop before recreating.
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
language sql
security definer
set search_path = public
stable
as $$
  with month_start as (select date_trunc('month', now()) as ts)
  select
    g.id                                   as gym_id,
    coalesce(g.gym_name, 'Unknown Gym')    as gym_name,
    coalesce(nullif(trim(g.city), ''), 'ALIGARH') as city,
    g.latitude::numeric                    as latitude,
    g.longitude::numeric                   as longitude,
    g.logo_url                             as logo_url,
    coalesce((
      select sum(w.calories_burned)::numeric
      from public.workout_logs w, month_start ms
      where w.gym_id = g.id and w.created_at >= ms.ts
    ), 0)                                  as monthly_calories,
    coalesce((
      select count(*)
      from public.members m
      where m.gym_id = g.id and lower(coalesce(m.status, '')) = 'active'
    ), 0)                                  as active_members,
    coalesce((
      select count(*)
      from public.check_ins c, month_start ms
      where c.gym_id = g.id and c.check_in_time >= ms.ts
    ), 0)                                  as monthly_checkins,
    -- "Alive now": any workout logged in this gym in the last 12 minutes. This
    -- is the server-side signal that drives the leaderboard pulse for EVERY
    -- viewer, since raw workout_logs are RLS-scoped per gym.
    exists (
      select 1 from public.workout_logs w
      where w.gym_id = g.id and w.created_at >= now() - interval '12 minutes'
    )                                      as is_active
  from public.gym_settings g
  where upper(coalesce(nullif(trim(g.city), ''), 'ALIGARH'))
        = upper(coalesce(nullif(trim(p_city), ''), 'ALIGARH'))
  order by monthly_calories desc, gym_name asc;
$$;

revoke all on function public.get_city_gym_leaderboard(text) from public;
grant execute on function public.get_city_gym_leaderboard(text) to authenticated, anon;
