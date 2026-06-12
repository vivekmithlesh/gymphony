-- =============================================================================
-- WORKOUT SESSION INTEGRITY — make vibe points TRUE, not fakeable
-- -----------------------------------------------------------------------------
-- Before this migration the member dashboard logged workouts by (1) inserting
-- rows straight into workout_logs and (2) writing the gym's gym_profiles.vibe_points
-- directly from the browser. Both are client-controlled, so a member could:
--   • click "Finish Session" any number of times to stack points, and
--   • from devtools, INSERT arbitrary workout_logs or SET vibe_points = 999999,
-- inflating their gym to #1 from their couch. The leaderboard also sums
-- workout_logs.calories_burned, so fake logs poison it even without touching
-- vibe_points. None of it required being at the gym.
--
-- This closes the hole the same way attendance was secured (see
-- 20260603_process_wall_checkin): the ONLY way to earn points is a SECURITY
-- DEFINER RPC that re-authorizes server-side and enforces every rule the client
-- cannot be trusted to. Direct client writes to both tables are then blocked.
--
-- Rules enforced server-side:
--   1. AUTH        — a member may only log their own session (auth.uid()).
--   2. PRESENCE    — must have a check_in TODAY at this gym. Check-in already
--                    passed the 100m geo-fence, so "checked in" == "was here".
--   3. ONCE/DAY    — one finished session per member per LOCAL day, enforced by a
--                    unique key (race-safe), mirroring member_goal_completions.
--   4. TRUE CALS   — calories are computed HERE from a fixed MET table; whatever
--                    the client sends for calories_burned is ignored.
--
-- LOCAL date is supplied by the client (the browser knows the member's timezone);
-- we do not use CURRENT_DATE (that is the server's UTC date and rolls over at the
-- wrong moment for non-UTC members) — same reasoning as the goal-completions table.
--
-- Idempotent; safe to re-run. Apply AFTER 20260603_process_wall_checkin.
-- =============================================================================

begin;

-- ── 1. One-session-per-day ledger ───────────────────────────────────────────
-- One row per finished session. The unique key is the daily cap: a second finish
-- the same local day hits a unique_violation, which the RPC turns into a clean
-- "already logged today" instead of awarding points again.
create table if not exists public.workout_sessions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null,
  gym_id         uuid not null,
  session_date   date not null,
  workout_count  int  not null default 0,
  total_calories int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (member_id, session_date)
);

create index if not exists workout_sessions_member_date_idx
  on public.workout_sessions (member_id, session_date);

alter table public.workout_sessions enable row level security;

-- Members may READ their own session history (for the "logged today" lock + future
-- streaks). They never INSERT/UPDATE directly — that is the RPC's job.
drop policy if exists "Members read own workout sessions" on public.workout_sessions;
create policy "Members read own workout sessions"
  on public.workout_sessions
  for select
  to authenticated
  using ( auth.uid() = member_id );

-- ── 2. vibe_points guard ─────────────────────────────────────────────────────
-- A trigger that blocks ANY change to gym_profiles.vibe_points unless the writer
-- set a transaction-local flag. Only log_workout_session sets that flag, and the
-- PostgREST/JS client cannot set GUCs — so direct member writes are rejected while
-- every OTHER column of gym_profiles stays editable by its normal owners.
create or replace function public.guard_vibe_points()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.allow_vibe_write', true), '') <> '1' then
    if tg_op = 'UPDATE' and new.vibe_points is distinct from old.vibe_points then
      raise exception 'vibe_points may only be changed via log_workout_session()';
    elsif tg_op = 'INSERT' and coalesce(new.vibe_points, 0) <> 0 then
      raise exception 'vibe_points may only be set via log_workout_session()';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_vibe_points on public.gym_profiles;
create trigger trg_guard_vibe_points
  before insert or update on public.gym_profiles
  for each row execute function public.guard_vibe_points();

-- ── 3. The only legitimate way to log a workout + earn points ────────────────
-- p_items: jsonb array of { "activity": text, "duration_minutes": number }.
-- p_local_date: member's LOCAL calendar date (daily-cap key).
-- p_day_start:  member's LOCAL midnight as a UTC instant (presence window bound),
--               computed client-side exactly like fetchTodayCheckin does.
create or replace function public.log_workout_session(
  p_member_id  uuid,
  p_gym_id     uuid,
  p_items      jsonb,
  p_local_date date,
  p_day_start  timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item        jsonb;
  v_activity    text;
  v_duration    numeric;
  v_met         numeric;
  v_cal         int;
  v_total_cal   int := 0;
  v_count       int := 0;
  v_max_minutes constant numeric := 600;   -- sanity clamp: no single bout > 10h
begin
  -- 1. AUTHORIZATION — only the member themselves.
  if auth.uid() is null or auth.uid() <> p_member_id then
    return jsonb_build_object('success', false, 'error', 'not_authorized',
      'message', 'Not authorized to log this session.');
  end if;

  -- 2. Gym must exist.
  if not exists (select 1 from public.gym_settings where id = p_gym_id) then
    return jsonb_build_object('success', false, 'error', 'invalid_gym',
      'message', 'This gym does not exist.');
  end if;

  -- 3. PRESENCE — must have checked in (geo-fenced) today at THIS gym.
  if not exists (
    select 1 from public.check_ins ci
    where ci.member_id = p_member_id
      and ci.gym_id = p_gym_id
      and ci.check_in_time >= p_day_start
  ) then
    return jsonb_build_object('success', false, 'error', 'not_checked_in',
      'message', 'Check in at the gym (scan the wall QR) before logging your workout.');
  end if;

  -- 4. Items present.
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error', 'no_items',
      'message', 'Add at least one workout.');
  end if;

  -- 5. ONCE/DAY — claim today's slot first. Unique violation => already logged.
  begin
    insert into public.workout_sessions (member_id, gym_id, session_date)
    values (p_member_id, p_gym_id, p_local_date);
  exception when unique_violation then
    return jsonb_build_object('success', false, 'error', 'already_logged',
      'message', 'You have already logged a session today. Come back tomorrow!');
  end;

  -- 6. Insert each workout with SERVER-computed calories (client values ignored).
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_activity := coalesce(v_item->>'activity', '');
    v_duration := coalesce(nullif(v_item->>'duration_minutes','')::numeric, 0);

    if v_duration <= 0 then
      continue;                         -- skip junk entries
    end if;
    if v_duration > v_max_minutes then
      v_duration := v_max_minutes;      -- clamp absurd durations
    end if;

    -- MET table mirrors the client's metValues; round() matches estimateCalories:
    --   calories = round(met * 3.5 * 70kg / 200 * minutes)
    v_met := case v_activity
      when 'Running'      then 9.0
      when 'Weightlifting' then 5.5
      when 'Cycling'      then 7.5
      when 'HIIT'         then 9.0
      when 'HIIT-Box'     then 9.5
      when 'Swimming'     then 7.5
      when 'Yoga'         then 3.5
      when 'Walking'      then 3.5
      else 3.0
    end;
    v_cal := round(v_met * 3.5 * 70 / 200 * v_duration);

    insert into public.workout_logs (user_id, gym_id, activity_type, duration_minutes, calories_burned, created_at)
    values (p_member_id, p_gym_id, v_activity, v_duration, v_cal, now());

    v_total_cal := v_total_cal + v_cal;
    v_count := v_count + 1;
  end loop;

  -- Every item was junk → undo the empty claim so they can retry today.
  if v_count = 0 then
    delete from public.workout_sessions
      where member_id = p_member_id and session_date = p_local_date;
    return jsonb_build_object('success', false, 'error', 'no_valid_items',
      'message', 'Add at least one valid workout.');
  end if;

  -- 7. Finalize the session totals.
  update public.workout_sessions
     set workout_count = v_count, total_calories = v_total_cal
   where member_id = p_member_id and session_date = p_local_date;

  -- 8. Award gym vibe points atomically. The flag lets THIS write past the guard.
  perform set_config('app.allow_vibe_write', '1', true);
  update public.gym_profiles
     set vibe_points = coalesce(vibe_points, 0) + v_total_cal
   where id = p_gym_id;

  return jsonb_build_object(
    'success', true,
    'workout_count', v_count,
    'total_calories', v_total_cal
  );
end;
$$;

-- Only signed-in users may call it; the body still enforces self-only logging.
revoke all on function public.log_workout_session(uuid, uuid, jsonb, date, timestamptz) from public;
grant execute on function public.log_workout_session(uuid, uuid, jsonb, date, timestamptz) to authenticated;

-- ── 4. Block direct client writes — the RPC (SECURITY DEFINER) is exempt ──────
-- After this, members can still READ workout_logs (Today's Burn, leaderboards) but
-- cannot INSERT rows directly; the only writer is log_workout_session.
revoke insert on public.workout_logs from authenticated;
revoke insert on public.workout_logs from anon;

commit;
