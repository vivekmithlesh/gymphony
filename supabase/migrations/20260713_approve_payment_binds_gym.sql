-- =============================================================================
-- 20260713 — approve_payment binds the member to the gym + backfill.
-- -----------------------------------------------------------------------------
-- BUG (reported): a member pays and the owner approves, but the member's
-- profiles.gym_id / gym_owner_id never get set, so:
--   • the member dashboard shows "Join a Gym" even though status='Active', and
--   • the member never appears in the owner's Members list,
--   • the member re-opens /join, pays again → loop.
-- The client-side join link (JoinGymFlow.linkMember) is the only thing that set
-- the binding, and it isn't landing reliably (RLS/edge). The PAYMENT row already
-- carries the authoritative gym_id + gym_owner_id, so approval is the right place
-- to bind it — server-side, definer, can't be blocked by RLS/triggers
-- (gym_id/gym_owner_id are NOT lockdown-protected columns).
--
-- Also backfills every member who already has an approved payment but no binding
-- (fixes the members already stuck in this state).
--
-- Idempotent (create or replace + guarded backfill); safe to re-run.
-- =============================================================================

begin;

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
  v_duration    integer;
  v_expiry      timestamptz;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  select member_id, gym_id, plan_name, amount, status
    into v_member, v_gym, v_plan, v_amount, v_status
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

  -- Activate (status/plan/expiry via the single authorized writer).
  perform public.app_activate_member(v_member, v_plan, v_expiry);

  -- Bind the member to THIS gym so the member dashboard unlocks and they appear in
  -- the owner's list. gym_id/gym_owner_id aren't lockdown columns; definer clears RLS.
  if v_member is not null and v_gym is not null then
    update public.profiles
       set gym_id = v_gym, gym_owner_id = v_owner
     where id = v_member;
  end if;

  select coalesce(m.full_name, m.member_name, 'A member')
    into v_member_name from public.members m where m.id = v_member;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (
    v_owner, 'payment',
    coalesce(v_member_name, 'A member') || ' payment of ₹' || v_amount::text || ' approved (' || coalesce(v_plan, 'plan') || ').',
    false
  );

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan);
end;
$$;

revoke all on function public.approve_payment(uuid) from public;
grant execute on function public.approve_payment(uuid) to authenticated;

-- ── Backfill: existing approved members with no gym binding ──────────────────
update public.profiles p
   set gym_id       = coalesce(p.gym_id, pay.gym_id),
       gym_owner_id = coalesce(p.gym_owner_id, pay.gym_owner_id)
  from (
    select distinct on (member_id)
           member_id, gym_id, gym_owner_id
    from public.payments
    where status in ('Success', 'Paid')
      and member_id is not null
      and gym_id is not null
    order by member_id, created_at desc
  ) pay
 where p.id = pay.member_id
   and (p.gym_id is null or p.gym_owner_id is null);

commit;

notify pgrst, 'reload schema';
