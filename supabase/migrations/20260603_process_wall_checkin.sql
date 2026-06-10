-- =============================================================================
-- Inverted Wall QR Check-in  —  secure, geo-fenced attendance RPC
-- -----------------------------------------------------------------------------
-- A gym prints ONE static QR encoding {"gym_id": "<gym_settings.id>"}. The MEMBER
-- scans it with their own phone, the app reads their GPS, and calls this function.
--
-- Security model:
--   • SECURITY DEFINER so it can write check_ins (members have no INSERT policy)
--     WITHOUT loosening RLS. We re-authorize inside: a member may only check
--     *themselves* in (auth.uid() must equal p_member_id).
--   • Geo-fence: the member must be within RADIUS metres of the gym's
--     gym_settings.latitude/longitude (Haversine). Outside => hard failure.
--   • Duplicate guard: at most one wall check-in per member per gym in 4h, so a
--     re-scan can't spam the owner's Live feed.
--
-- Returns jsonb so the client can branch on success / geo-fence / already-in.
-- Canonical gym entity is public.gym_settings (no separate "gyms" table).
-- Safe to run multiple times.
-- =============================================================================

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
  v_radius      constant double precision := 100;   -- geo-fence radius, metres
  v_checkin_id  uuid;
  v_now         timestamptz := now();
begin
  -- 1. AUTHORIZATION — a member can only check themselves in.
  if auth.uid() is null or auth.uid() <> p_member_id then
    return jsonb_build_object('success', false, 'error', 'Not authorized to check in for this member.');
  end if;

  -- 2. Resolve the gym's coordinates + owner (for the activity feed).
  select g.latitude, g.longitude, g.gym_owner_id
    into v_gym_lat, v_gym_lng, v_gym_owner
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

  -- 4. GEO-FENCE — must be physically at the gym.
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
