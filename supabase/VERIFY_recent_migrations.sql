-- =============================================================================
-- VERIFY which recent migrations are actually applied to the LIVE database.
-- -----------------------------------------------------------------------------
-- Read-only. Returns one row per expected object with present = t / f.
-- Anything showing present = f means that migration has NOT been applied (or
-- only partially). Run in the Supabase SQL editor; scan the `present` column.
--
-- Covers 20260613 .. 20260618. (Payments hardening 20260606..12 has its own
-- checker: VERIFY_payments_hardening_20260606_20260612.sql)
-- =============================================================================

with checks(migration, object, present) as (

  -- 20260613_gym_today_stats
  select '20260613_gym_today_stats', 'fn get_gym_today_stats',
         exists(select 1 from pg_proc where proname = 'get_gym_today_stats')

  -- 20260613_subscription_start
  union all select '20260613_subscription_start', 'col profiles.subscription_start',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='profiles' and column_name='subscription_start')
  union all select '20260613_subscription_start', 'fn app_activate_member',
         exists(select 1 from pg_proc where proname = 'app_activate_member')
  union all select '20260613_subscription_start', 'fn app_lock_membership_columns',
         exists(select 1 from pg_proc where proname = 'app_lock_membership_columns')

  -- 20260614_member_goal_daily_completions
  union all select '20260614_member_goal_daily_completions', 'table member_goal_completions',
         exists(select 1 from information_schema.tables
                where table_schema='public' and table_name='member_goal_completions')

  -- 20260615_workout_session_integrity
  union all select '20260615_workout_session_integrity', 'table workout_sessions',
         exists(select 1 from information_schema.tables
                where table_schema='public' and table_name='workout_sessions')
  union all select '20260615_workout_session_integrity', 'fn log_workout_session',
         exists(select 1 from pg_proc where proname = 'log_workout_session')
  union all select '20260615_workout_session_integrity', 'fn guard_vibe_points',
         exists(select 1 from pg_proc where proname = 'guard_vibe_points')
  union all select '20260615_workout_session_integrity', 'trigger trg_guard_vibe_points',
         exists(select 1 from pg_trigger where tgname = 'trg_guard_vibe_points')

  -- 20260616_checkin_radius_per_gym
  union all select '20260616_checkin_radius_per_gym', 'col gym_settings.checkin_radius_m',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='gym_settings' and column_name='checkin_radius_m')
  union all select '20260616_checkin_radius_per_gym', 'fn process_wall_checkin',
         exists(select 1 from pg_proc where proname = 'process_wall_checkin')

  -- 20260617_self_serve_join
  union all select '20260617_self_serve_join', 'col gym_settings.allow_mock_payments',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='gym_settings' and column_name='allow_mock_payments')
  union all select '20260617_self_serve_join', 'fn app_simulate_online_payment',
         exists(select 1 from pg_proc where proname = 'app_simulate_online_payment')

  -- 20260618_gym_plans_plan_name
  union all select '20260618_gym_plans_plan_name', 'col gym_plans.plan_name',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='gym_plans' and column_name='plan_name')
  union all select '20260618_gym_plans_plan_name', 'col gym_plans.duration_days',
         exists(select 1 from information_schema.columns
                where table_schema='public' and table_name='gym_plans' and column_name='duration_days')
)
select migration,
       object,
       present,
       case when present then 'OK' else '*** MISSING — apply this migration ***' end as status
from checks
order by migration, object;
