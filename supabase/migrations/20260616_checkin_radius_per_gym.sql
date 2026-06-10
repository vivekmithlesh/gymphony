-- =============================================================================
-- Per-gym Wall QR check-in radius
-- -----------------------------------------------------------------------------
-- The geo-fence radius for process_wall_checkin was a hardcoded 100 m constant
-- (see 20260603_process_wall_checkin.sql). Different gyms occupy different
-- footprints (a single studio vs. a multi-floor club with a parking lot), so the
-- owner now sets their own radius in Settings. This migration:
--   1. adds gym_settings.checkin_radius_m (default 100, bounded 20..2000), and
--   2. re-creates process_wall_checkin to read that per-gym value instead of the
--      hardcoded constant, falling back to 100 m if the column is null.
--
-- Bounds rationale: below ~20 m is finer than consumer phone GPS can resolve
-- (guaranteed false rejections); 2000 m caps a fat-finger that would otherwise
-- effectively disable the geo-fence. Idempotent; safe to re-run.
-- =============================================================================

-- 1. Per-gym radius column. NOT NULL DEFAULT is a fast catalog-only change on
--    modern Postgres (no full table rewrite); existing rows read back as 100.
alter table public.gym_settings
  add column if not exists checkin_radius_m numeric not null default 100;

-- 2. Sane bounds, guarded so re-running doesn't error on the existing constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'gym_settings_checkin_radius_m_check'
  ) then
    alter table public.gym_settings
      add constraint gym_settings_checkin_radius_m_check
      check (checkin_radius_m >= 20 and checkin_radius_m <= 2000);
  end if;
end$$;

-- 3. Re-create the check-in RPC to read the per-gym radius. Body is identical to
--    20260603 except: v_radius is resolved from gym_settings (coalesced to 100),
--    not a hardcoded constant.
create or replace function public.process_wall_checkin(
  p_member_id uuid,
  p_gym_id    uuid,
  p_user_lat  double precision,
  p_user_lng  double precision
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gym_lat     double precision;
  v_gym_lng     double precision;
  v_gym_owner   uuid;
  v_member_name text;
  v_distance    double precision;
  v_radius      double precision;          -- per-gym geo-fence radius, metres
  v_checkin_id  uuid;
  v_now         timestamptz := now();
begin
  -- 1. AUTHORIZATION — a member can only check themselves in.
  if auth.uid() is null or auth.uid() <> p_member_id then
    return jsonb_build_object('success', false, 'error', 'Not authorized to check in for this member.');
  end if;

  -- 2. Resolve the gym's coordinates, owner (for the activity feed), and radius.
  select g.latitude, g.longitude, g.gym_owner_id, coalesce(g.checkin_radius_m, 100)
    into v_gym_lat, v_gym_lng, v_gym_owner, v_radius
  from public.gym_settings g
  where g.id = p_gym_id;

  if not found then
    return jsonb_build_object('success', false, 'error', 'This QR code is not linked to a valid gym.');
  end if;

  if v_gym_lat is null or v_gym_lng is null then
    return jsonb_build_object(
      'success', false,
      'error', 'This gym has not set its location yet. Ask the front desk to set the gym location in Settings.'
    );
  end if;

  if p_user_lat is null or p_user_lng is null then
    return jsonb_build_object('success', false, 'error', 'We could not read your location. Enable GPS and try again.');
  end if;

  -- 3. Haversine great-circle distance in metres (R = 6,371,000 m).
  v_distance := 2 * 6371000 * asin(
    sqrt(
      power(sin(radians(p_user_lat - v_gym_lat) / 2), 2)
      + cos(radians(v_gym_lat)) * cos(radians(p_user_lat))
        * power(sin(radians(p_user_lng - v_gym_lng) / 2), 2)
    )
  );

  -- 4. GEO-FENCE — must be physically at the gym (per-gym radius).
  if v_distance > v_radius then
    return jsonb_build_object(
      'success', false,
      'error', 'Geo-fence validation failed',
      'message', 'You are too far from the gym to check in.',
      'distance', round(v_distance::numeric, 1)
    );
  end if;

  -- 5. DUPLICATE GUARD — one wall check-in per member per gym within 4 hours.
  if exists (
    select 1 from public.check_ins ci
    where ci.member_id = p_member_id
      and ci.gym_id = p_gym_id
      and ci.check_in_time > v_now - interval '4 hours'
  ) then
    return jsonb_build_object(
      'success', true,
      'already_checked_in', true,
      'distance', round(v_distance::numeric, 1),
      'message', 'You are already checked in.'
    );
  end if;

  select coalesce(m.full_name, m.member_name, 'A member')
    into v_member_name
  from public.members m
  where m.id = p_member_id;

  -- 6. Record attendance. (RLS is bypassed by SECURITY DEFINER; step 1 authorized.)
  insert into public.check_ins (member_id, gym_id, status, check_in_time)
  values (p_member_id, p_gym_id, 'granted', v_now)
  returning id into v_checkin_id;

  -- 7. Activity feed row so the owner dashboard's EXISTING realtime
  --    (activity_log filtered by gym_owner_id) lights up instantly.
  if v_gym_owner is not null then
    insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
    values (v_gym_owner, 'attendance', coalesce(v_member_name, 'A member') || ' checked in via Wall QR.', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'check_in_id', v_checkin_id,
    'check_in_time', v_now,
    'distance', round(v_distance::numeric, 1)
  );
end;
$$;

-- Only signed-in users may call it; the body still enforces self-only check-in.
revoke all on function public.process_wall_checkin(uuid, uuid, double precision, double precision) from public;
grant execute on function public.process_wall_checkin(uuid, uuid, double precision, double precision) to authenticated;
