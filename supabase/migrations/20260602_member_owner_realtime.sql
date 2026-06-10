-- =============================================================================
-- Connect Member Dashboard <-> Owner Dashboard + enable realtime.
--   * Ensure gym_settings has the coordinate columns the owner saves and the
--     member needs to render the gym location.
--   * Add the member-facing tables to the supabase_realtime publication so the
--     dashboard updates live.
-- =============================================================================

-- 1. Gym coordinates (owner writes these in SettingsView; member reads them).
alter table public.gym_settings add column if not exists latitude  numeric;
alter table public.gym_settings add column if not exists longitude numeric;

-- 2. Realtime: publish the tables the member dashboard subscribes to.
--    Guarded so it is safe to re-run and skips tables that don't exist.
do $$
declare
  t text;
  tables text[] := array[
    'workout_logs', 'check_ins', 'activity_log',
    'gym_settings', 'gym_profiles', 'member_notes'
  ];
begin
  foreach t in array tables loop
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = t
      )
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 3. REPLICA IDENTITY FULL so realtime delivers full old/new rows (needed for
--    DELETE events and reliable filtered subscriptions).
do $$
declare
  t text;
  tables text[] := array['workout_logs', 'check_ins', 'activity_log'];
begin
  foreach t in array tables loop
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = t
      )
    then
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;
