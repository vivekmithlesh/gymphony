-- =============================================================================
-- 20260708 — Owner-added "offline" members via a FK-free member_invites table.
-- -----------------------------------------------------------------------------
-- WHY: `public.profiles.id` is FK-bound to `auth.users` (profiles_id_fkey), so a
-- member row can only exist for a real auth account. An owner adding a member at
-- the desk (who has no account yet) therefore CANNOT be a profiles/members row.
-- This table holds those pending members until they sign up; on signup their
-- profiles row (id = auth.uid()) is created and the invite is marked claimed.
--
-- Flow:
--   owner Add Member → app_add_member_invite() inserts a 'pending' invite
--     (gym resolved from auth.uid(); never trusts a client gym_id) →
--   member opens the gym's /join QR, signs up (auth user + profiles row) →
--   app_claim_member_invite() matches the invite by the member's phone and marks
--     it 'claimed' (so it drops out of the owner's pending list) →
--   member pays → owner approves → profiles.status = 'Active'.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

create table if not exists public.member_invites (
  id              uuid primary key default gen_random_uuid(),
  gym_id          uuid not null,
  gym_owner_id    uuid not null,
  full_name       text not null,
  phone           text,
  mobile_number   text,
  membership_plan text,
  expiry_date     timestamptz,
  status          text not null default 'pending',  -- pending | claimed | cancelled
  claimed_by      uuid,                              -- auth.uid() of the claimer
  claimed_at      timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists member_invites_gym_owner_idx on public.member_invites (gym_owner_id);
create index if not exists member_invites_gym_id_idx     on public.member_invites (gym_id);
create index if not exists member_invites_phone_idx      on public.member_invites (phone);

alter table public.member_invites enable row level security;

-- Owner has full control of their own gym's invites (read for the member list,
-- delete to cancel). Add goes through the RPC below; claiming is definer-only.
drop policy if exists member_invites_owner_all on public.member_invites;
create policy member_invites_owner_all on public.member_invites
  for all to authenticated
  using (gym_owner_id = auth.uid())
  with check (gym_owner_id = auth.uid());

-- ---------------------------------------------------------------------------
-- app_add_member_invite — owner-authoritative create (gym resolved from auth.uid).
-- Rejects duplicates: an existing real member OR an open invite with the phone.
-- ---------------------------------------------------------------------------
create or replace function public.app_add_member_invite(
  p_full_name text,
  p_phone     text,
  p_plan      text,
  p_expiry    timestamptz default null
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
    (gym_id, gym_owner_id, full_name, phone, mobile_number, membership_plan, expiry_date)
  values (v_gym, v_owner, v_name, v_phone, v_phone, nullif(trim(p_plan), ''), p_expiry)
  returning id into v_id;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (v_owner, 'invitation_created', v_name || ' was invited to your gym.', false);

  return jsonb_build_object('success', true, 'code', 'invited',
    'invite_id', v_id, 'gym_id', v_gym, 'member_name', v_name);
end;
$$;

revoke all on function public.app_add_member_invite(text, text, text, timestamptz) from public, anon;
grant execute on function public.app_add_member_invite(text, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- app_claim_member_invite — a signed-in member consumes any pending invite for
-- the gym that matches their phone. Idempotent; returns how many were claimed.
-- ---------------------------------------------------------------------------
create or replace function public.app_claim_member_invite(p_gym_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member uuid := auth.uid();
  v_phone  text;
  v_count  int;
begin
  if v_member is null then
    return jsonb_build_object('success', false, 'code', 'unauthenticated');
  end if;

  select coalesce(nullif(trim(phone), ''), nullif(trim(mobile_number), ''))
    into v_phone
  from public.profiles where id = v_member;

  if v_phone is null then
    return jsonb_build_object('success', true, 'claimed', 0);
  end if;

  update public.member_invites
     set status = 'claimed', claimed_by = v_member, claimed_at = now()
   where gym_id = p_gym_id and status = 'pending'
     and (phone = v_phone or mobile_number = v_phone);
  get diagnostics v_count = row_count;

  return jsonb_build_object('success', true, 'claimed', v_count);
end;
$$;

revoke all on function public.app_claim_member_invite(uuid) from public, anon;
grant execute on function public.app_claim_member_invite(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
