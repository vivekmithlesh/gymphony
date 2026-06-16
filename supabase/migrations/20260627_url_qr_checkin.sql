-- =============================================================================
-- 20260627 — URL-based QR onboarding & attendance
-- -----------------------------------------------------------------------------
-- PROBLEM: join/check-in QR posters encoded app-private JSON, so a normal phone
-- camera could not act on them. The new posters encode real deep-links
-- (/join/:gym_id, /checkin/:gym_id) that open the web app. This migration adds
-- the server side of the URL check-in:
--   • gym_settings.checkin_window_minutes  — the CONFIGURABLE duplicate-attendance
--     window (default 240 = 4h, matching the previous process_wall_checkin guard).
--   • app_self_checkin(gym_id, lat, lng)   — authenticated member self check-in:
--     verifies active membership of THIS gym, optional geo-fence (only when the
--     gym has coordinates), dedupes within the configurable window, records the
--     attendance + qr_scans audit row + owner activity feed.
--   • app_log_qr_scan(...)                 — lets the client record a scan event
--     (e.g. a join-poster scan) into qr_scans, which has no client INSERT policy.
--
-- The trust boundary stays in the database (SECURITY DEFINER): the browser never
-- decides the outcome, and a member can only ever check THEMSELVES in.
-- Idempotent and safe to re-run. Depends on qr_scans (20260625) and the
-- check_ins.gym_id column (20260602).
-- =============================================================================

-- 1. Configurable duplicate-attendance window (minutes), per gym. -------------
alter table public.gym_settings
  add column if not exists checkin_window_minutes integer not null default 240;

-- 2. app_self_checkin — URL/QR self check-in for an authenticated member. ------
create or replace function public.app_self_checkin(
  p_gym_id uuid,
  p_lat    double precision default null,
  p_lng    double precision default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid          uuid := auth.uid();
  v_gym_lat      double precision;
  v_gym_lng      double precision;
  v_gym_owner    uuid;
  v_window       integer;
  v_member_gym   uuid;
  v_status       text;
  v_member_name  text;
  v_distance     double precision;
  v_radius       constant double precision := 100;   -- geo-fence radius, metres
  v_checkin_id   uuid;
  v_now          timestamptz := now();
begin
  -- AUTHZ: only a signed-in user, and only ever for themselves.
  if v_uid is null then
    return jsonb_build_object('success', false, 'code', 'unauthenticated',
      'error', 'Please sign in to check in.');
  end if;

  -- Resolve the gym (coords + owner + its configurable window).
  select g.latitude, g.longitude, g.gym_owner_id, coalesce(g.checkin_window_minutes, 240)
    into v_gym_lat, v_gym_lng, v_gym_owner, v_window
  from public.gym_settings g
  where g.id = p_gym_id;

  if not found then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
    values (null, v_uid, p_gym_id, 'checkin', 'invalid', 'gym not found');
    return jsonb_build_object('success', false, 'code', 'invalid_gym',
      'error', 'This check-in code is not linked to a valid gym.');
  end if;

  -- Resolve membership from profiles (canonical base table; no RLS on it).
  select p.gym_id, lower(coalesce(p.status, '')), coalesce(p.full_name, 'Member')
    into v_member_gym, v_status, v_member_name
  from public.profiles p
  where p.id = v_uid;

  -- MEMBERSHIP VERIFICATION — must be a member of THIS gym.
  if v_member_gym is distinct from p_gym_id then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
    values (v_gym_owner, v_uid, p_gym_id, 'checkin', 'denied', 'not a member of this gym');
    return jsonb_build_object('success', false, 'code', 'not_member',
      'error', 'You are not a member of this gym yet. Join first, then check in.');
  end if;

  if v_status <> 'active' then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
    values (v_gym_owner, v_uid, p_gym_id, 'checkin', 'denied', 'membership not active: ' || v_status);
    return jsonb_build_object('success', false, 'code', 'inactive',
      'error', 'Your membership is not active. Please renew to check in.');
  end if;

  -- Optional GEO-FENCE — enforced only when the gym has set coordinates.
  if v_gym_lat is not null and v_gym_lng is not null then
    if p_lat is null or p_lng is null then
      return jsonb_build_object('success', false, 'code', 'need_location',
        'error', 'Enable location to confirm you are at the gym, then try again.');
    end if;

    v_distance := 2 * 6371000 * asin(
      sqrt(
        power(sin(radians(p_lat - v_gym_lat) / 2), 2)
        + cos(radians(v_gym_lat)) * cos(radians(p_lat))
          * power(sin(radians(p_lng - v_gym_lng) / 2), 2)
      )
    );

    if v_distance > v_radius then
      insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
      values (v_gym_owner, v_uid, p_gym_id, 'checkin', 'denied',
              'geo-fence ' || round(v_distance::numeric, 1) || 'm');
      return jsonb_build_object('success', false, 'code', 'too_far',
        'error', 'Geo-fence validation failed',
        'message', 'You are too far from the gym to check in.',
        'distance', round(v_distance::numeric, 1));
    end if;
  end if;

  -- DUPLICATE GUARD — one check-in per member per gym inside the configured window.
  if exists (
    select 1 from public.check_ins ci
    where ci.member_id = v_uid
      and ci.gym_id = p_gym_id
      and ci.check_in_time > v_now - make_interval(mins => v_window)
  ) then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
    values (v_gym_owner, v_uid, p_gym_id, 'checkin', 'granted', 'duplicate within window');
    return jsonb_build_object('success', true, 'already_checked_in', true,
      'member_name', v_member_name, 'message', 'You are already checked in.',
      'distance', case when v_distance is not null then round(v_distance::numeric, 1) else null end);
  end if;

  -- RECORD ATTENDANCE (RLS bypassed by SECURITY DEFINER; authorized above).
  insert into public.check_ins (member_id, gym_id, status, check_in_time)
  values (v_uid, p_gym_id, 'granted', v_now)
  returning id into v_checkin_id;

  insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
  values (v_gym_owner, v_uid, p_gym_id, 'checkin', 'granted', 'self check-in via URL QR');

  if v_gym_owner is not null then
    insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
    values (v_gym_owner, 'attendance', v_member_name || ' checked in via QR.', false);
  end if;

  return jsonb_build_object(
    'success', true,
    'check_in_id', v_checkin_id,
    'member_name', v_member_name,
    'check_in_time', v_now,
    'distance', case when v_distance is not null then round(v_distance::numeric, 1) else null end
  );
end;
$$;

revoke all on function public.app_self_checkin(uuid, double precision, double precision) from public, anon;
grant execute on function public.app_self_checkin(uuid, double precision, double precision) to authenticated;

-- 3. app_log_qr_scan — client-recordable scan audit row (join-poster scans, etc.)
--    qr_scans has no client INSERT policy, so this definer wrapper is the only
--    sanctioned path. It can only ever attribute the scan to the caller.
create or replace function public.app_log_qr_scan(
  p_gym_id uuid,
  p_source text,
  p_result text,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_owner uuid;
begin
  select gym_owner_id into v_owner from public.gym_settings where id = p_gym_id;
  insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, source, result, reason)
  values (
    v_owner,
    v_uid,
    p_gym_id,
    coalesce(nullif(btrim(p_source), ''), 'unknown'),
    coalesce(nullif(btrim(p_result), ''), 'scanned'),
    p_reason
  );
end;
$$;

revoke all on function public.app_log_qr_scan(uuid, text, text, text) from public, anon;
grant execute on function public.app_log_qr_scan(uuid, text, text, text) to authenticated;

notify pgrst, 'reload schema';
