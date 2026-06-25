-- =============================================================================
-- 20260709 — Manual-add member fields + safe cross-gym switch.
-- -----------------------------------------------------------------------------
-- Part A (Phase 1): extend member_invites with the optional fields the owner
--   Add-Member form collects (email, start_date, payment_status, notes) and
--   widen app_add_member_invite to accept them. All new params DEFAULT NULL so
--   the previous 4-arg call still resolves — but the frontend now sends the full
--   set, so APPLY THIS MIGRATION before deploying the new dashboard build.
--
-- Part B (Phase 3): app_request_gym_switch — a member who is Active at another
--   gym can explicitly switch. The membership lockdown forbids a client status
--   change, so this SECURITY DEFINER RPC (sets the allow-flag) resets them to
--   Pending for the new gym. Never grants access by itself — they still pay and
--   get approved by the new gym.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- ── Part A: member_invites fields ───────────────────────────────────────────
alter table public.member_invites add column if not exists email          text;
alter table public.member_invites add column if not exists start_date     date;
alter table public.member_invites add column if not exists payment_status text;   -- 'paid' | 'pending' | 'partial' | null
alter table public.member_invites add column if not exists notes          text;

create index if not exists member_invites_status_idx on public.member_invites (status);

-- One open invite per phone per gym (prevents duplicate pending invites). Partial
-- so claimed/cancelled rows don't block re-inviting later.
create unique index if not exists member_invites_pending_phone_uq
  on public.member_invites (gym_owner_id, phone)
  where status = 'pending';

-- Drop the prior 4-arg version first, otherwise the widened signature below
-- becomes an OVERLOAD and a 4-named-arg call would be ambiguous (PGRST203).
drop function if exists public.app_add_member_invite(text, text, text, timestamptz);

create or replace function public.app_add_member_invite(
  p_full_name      text,
  p_phone          text,
  p_plan           text,
  p_expiry         timestamptz default null,
  p_email          text        default null,
  p_start_date     date        default null,
  p_payment_status text        default null,
  p_notes          text        default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_gym   uuid;
  v_id    uuid;
  v_name  text := nullif(trim(p_full_name), '');
  v_phone text := nullif(trim(p_phone), '');
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'code', 'unauthenticated', 'error', 'Not signed in.');
  end if;

  select id into v_gym from public.gym_settings where gym_owner_id = v_owner limit 1;
  if v_gym is null then
    return jsonb_build_object('success', false, 'code', 'no_gym',
      'error', 'Finish your gym setup before adding members.');
  end if;

  if v_name is null then
    return jsonb_build_object('success', false, 'code', 'invalid', 'error', 'Member name is required.');
  end if;
  if v_phone is null then
    return jsonb_build_object('success', false, 'code', 'invalid', 'error', 'A valid phone number is required.');
  end if;

  if exists (
    select 1 from public.profiles
    where gym_owner_id = v_owner and (phone = v_phone or mobile_number = v_phone)
  ) then
    return jsonb_build_object('success', false, 'code', 'exists',
      'error', 'A member with this phone number already exists in your gym.');
  end if;

  if exists (
    select 1 from public.member_invites
    where gym_owner_id = v_owner and status = 'pending'
      and (phone = v_phone or mobile_number = v_phone)
  ) then
    return jsonb_build_object('success', false, 'code', 'invited',
      'error', 'You have already invited this phone number.');
  end if;

  insert into public.member_invites
    (gym_id, gym_owner_id, full_name, phone, mobile_number, membership_plan,
     expiry_date, email, start_date, payment_status, notes)
  values (v_gym, v_owner, v_name, v_phone, v_phone, nullif(trim(p_plan), ''),
          p_expiry, nullif(trim(p_email), ''), p_start_date,
          nullif(trim(p_payment_status), ''), nullif(trim(p_notes), ''))
  returning id into v_id;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (v_owner, 'invitation_created', v_name || ' was invited to your gym.', false);

  return jsonb_build_object('success', true, 'code', 'invited',
    'invite_id', v_id, 'gym_id', v_gym, 'member_name', v_name);
end;
$$;

revoke all on function public.app_add_member_invite(text, text, text, timestamptz, text, date, text, text) from public, anon;
grant execute on function public.app_add_member_invite(text, text, text, timestamptz, text, date, text, text) to authenticated;

-- ── Part B: cross-gym switch ────────────────────────────────────────────────
create or replace function public.app_request_gym_switch(p_gym_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid := auth.uid();
  v_owner  uuid;
begin
  if v_member is null then
    return jsonb_build_object('success', false, 'code', 'unauthenticated', 'error', 'Not signed in.');
  end if;

  select gym_owner_id into v_owner from public.gym_settings where id = p_gym_id;
  if v_owner is null then
    return jsonb_build_object('success', false, 'code', 'invalid_gym', 'error', 'That gym could not be found.');
  end if;

  -- Authorized membership write (resets status; lockdown trigger allows it via flag).
  perform set_config('app.allow_membership_write', 'on', true);

  update public.profiles
     set gym_id          = p_gym_id,
         gym_owner_id     = v_owner,
         status           = 'Pending',
         membership_plan  = null,
         expiry_date      = null
   where id = v_member;

  return jsonb_build_object('success', true, 'code', 'switched', 'gym_id', p_gym_id);
end;
$$;

revoke all on function public.app_request_gym_switch(uuid) from public, anon;
grant execute on function public.app_request_gym_switch(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
