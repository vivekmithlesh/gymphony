-- =============================================================================
-- 20260714 — Payment member snapshot + invite↔profile sync on approval.
-- -----------------------------------------------------------------------------
-- PROBLEMS FIXED:
--  1. Owner approval list shows generic "Member" instead of the real name.
--     ROOT CAUSE: OwnerPendingPayments resolves the name by READING the member's
--     profile, but after RLS hardening (20260712) an owner can only read profiles
--     in their own gym (gym_owner_id = auth.uid()), and a PENDING member isn't
--     bound to the gym yet → read returns nothing → "Member". Fix: snapshot
--     member_name + member_phone onto the payment at INSERT (server trigger, so it
--     works for every payment path), and link the matching invite.
--  2. The owner-created invite doesn't become "active" after approval.
--     Fix: approve_payment now also flips the matching member_invites row to
--     active/paid and stamps claimed_by + payment_id (keeps the gym-bind from
--     20260713). No duplicate: the invite leaves 'pending', the bound profile
--     shows as the real member.
--  3. Invite token for member-specific invite links (/join/:gymId?invite=<token>).
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- ── 1. New columns ──────────────────────────────────────────────────────────
alter table public.payments       add column if not exists member_name  text;
alter table public.payments       add column if not exists member_phone text;
alter table public.payments       add column if not exists invite_id    uuid;
alter table public.member_invites add column if not exists invite_token text;
alter table public.member_invites add column if not exists payment_id   uuid;

-- New invites auto-get a unique, URL-safe token (used by /join/:gymId?invite=<token>).
alter table public.member_invites
  alter column invite_token set default replace(gen_random_uuid()::text, '-', '');

-- Backfill a token for existing invites, then enforce uniqueness.
update public.member_invites
   set invite_token = replace(gen_random_uuid()::text, '-', '')
 where invite_token is null;

create unique index if not exists member_invites_invite_token_uq
  on public.member_invites (invite_token);

create index if not exists payments_invite_id_idx on public.payments (invite_id);

-- ── 2. Auto-snapshot member name/phone onto every payment (RLS-proof) ────────
create or replace function public.fn_fill_payment_member_snapshot()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_name  text;
  v_phone text;
  v_inv_id uuid;
  v_inv_name text;
begin
  -- The member's own profile is the primary source.
  select full_name, coalesce(nullif(trim(phone), ''), nullif(trim(mobile_number), ''))
    into v_name, v_phone
  from public.profiles where id = new.member_id;

  -- Fall back to a matching invite (same gym + phone) for the name + linkage.
  if new.gym_id is not null and v_phone is not null then
    select id, full_name into v_inv_id, v_inv_name
    from public.member_invites
    where gym_id = new.gym_id and (phone = v_phone or mobile_number = v_phone)
    order by created_at desc limit 1;
    if new.invite_id is null then new.invite_id := v_inv_id; end if;
    if v_name is null or v_name = '' then v_name := v_inv_name; end if;
  end if;

  if new.member_name  is null then new.member_name  := v_name;  end if;
  if new.member_phone is null then new.member_phone := v_phone; end if;
  return new;
end $$;

drop trigger if exists trg_fill_payment_member_snapshot on public.payments;
create trigger trg_fill_payment_member_snapshot
  before insert on public.payments
  for each row execute function public.fn_fill_payment_member_snapshot();

-- Backfill existing payments (definer function bypasses RLS for the read).
update public.payments pay
   set member_name  = coalesce(pay.member_name, p.full_name, mi.full_name, pay.payer_name),
       member_phone = coalesce(pay.member_phone, p.phone, p.mobile_number, mi.phone),
       invite_id    = coalesce(pay.invite_id, mi.id)
  from public.payments self
  left join public.profiles p on p.id = self.member_id
  left join lateral (
    select id, full_name, phone from public.member_invites m
    where m.gym_id = self.gym_id
      and (m.phone = coalesce(p.phone, p.mobile_number) or m.mobile_number = coalesce(p.phone, p.mobile_number))
    order by m.created_at desc limit 1
  ) mi on true
 where self.id = pay.id
   and (pay.member_name is null or pay.member_phone is null);

-- ── 3. approve_payment: activate profile + bind gym + sync the invite ────────
create or replace function public.approve_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner       uuid := auth.uid();
  v_member      uuid;
  v_gym         uuid;
  v_plan        text;
  v_amount      numeric;
  v_status      text;
  v_member_name text;
  v_member_phone text;
  v_invite_id   uuid;
  v_duration    integer;
  v_expiry      timestamptz;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  select member_id, gym_id, plan_name, amount, status, member_name, member_phone, invite_id
    into v_member, v_gym, v_plan, v_amount, v_status, v_member_name, v_member_phone, v_invite_id
  from public.payments
  where id = p_payment_id and gym_owner_id = v_owner
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found or not yours.');
  end if;
  if v_status = 'Success' then
    return jsonb_build_object('success', true, 'already', true);
  end if;

  select coalesce(
           gp.duration_days,
           case when (gp.duration)::text ~ '^[0-9]+$' then (gp.duration)::text::int * 30 end,
           30
         )
    into v_duration
  from public.gym_plans gp
  where gp.gym_id = v_gym and (gp.name = v_plan or gp.plan_name = v_plan)
  order by gp.created_at desc
  limit 1;
  if v_duration is null then v_duration := 30; end if;
  v_expiry := now() + make_interval(days => v_duration);

  update public.payments set status = 'Success' where id = p_payment_id;

  perform public.app_activate_member(v_member, v_plan, v_expiry);

  -- Bind the member to THIS gym (so the dashboard unlocks + they appear in the list).
  if v_member is not null and v_gym is not null then
    update public.profiles set gym_id = v_gym, gym_owner_id = v_owner where id = v_member;
  end if;

  -- Sync the owner-created invite (by explicit link, else by phone) → active/paid.
  update public.member_invites mi
     set status         = 'active',
         payment_status = 'paid',
         claimed_by     = coalesce(mi.claimed_by, v_member),
         claimed_at     = coalesce(mi.claimed_at, now()),
         payment_id     = p_payment_id
   where mi.gym_owner_id = v_owner
     and ( mi.id = v_invite_id
        or (v_member_phone is not null and (mi.phone = v_member_phone or mi.mobile_number = v_member_phone)) )
     and coalesce(mi.status, '') <> 'active';

  if v_member_name is null then
    select coalesce(m.full_name, m.member_name, 'A member')
      into v_member_name from public.members m where m.id = v_member;
  end if;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (
    v_owner, 'payment',
    coalesce(v_member_name, 'A member') || ' payment of ₹' || v_amount::text || ' approved (' || coalesce(v_plan, 'plan') || ').',
    false
  );

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan, 'member_name', v_member_name);
end;
$$;

revoke all on function public.approve_payment(uuid) from public;
grant execute on function public.approve_payment(uuid) to authenticated;

commit;

notify pgrst, 'reload schema';
