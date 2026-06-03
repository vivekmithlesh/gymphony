-- =============================================================================
-- Manual UPI payment verification (Flow 2, Step E — owner approval).
-- -----------------------------------------------------------------------------
-- Members submit fee payments with status 'pending_verification' (paid via the
-- gym's UPI QR). The owner approves or rejects from their dashboard. Approval is
-- a SECURITY DEFINER RPC so we can flip the payment AND activate the member's
-- plan atomically, authorized by payment.gym_owner_id = auth.uid(). This avoids
-- toggling RLS on the busy `payments` table (owners already read it).
--
-- Idempotent; safe to run multiple times.
-- =============================================================================

-- 1. APPROVE — mark Success + activate the member's membership. --------------
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

  -- Authorize: the payment must belong to a gym this owner owns.
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

  -- Resolve the plan's duration so we can set the expiry; default 30 days.
  -- duration/duration_days may be stored as text or int depending on the DB, so
  -- cast via text and guard against non-numeric values (fallback to the default).
  select coalesce(
    case when (gp.duration_days)::text ~ '^[0-9]+$' then (gp.duration_days)::text::int end,
    case when (gp.duration)::text      ~ '^[0-9]+$' then (gp.duration)::text::int * 30 end,
    30
  )
    into v_duration
  from public.gym_plans gp
  where gp.gym_id = v_gym and gp.name = v_plan
  order by gp.created_at desc
  limit 1;
  if v_duration is null then v_duration := 30; end if;

  -- The plan starts on approval and runs for its full duration — a clean,
  -- predictable window (approval date → approval date + duration).
  v_expiry := now() + make_interval(days => v_duration);

  -- Flip the payment to Success.
  update public.payments set status = 'Success' where id = p_payment_id;

  -- Activate the member. `members` is a non-updatable JOIN view, so we write the
  -- membership fields to the base `profiles` table that backs it.
  update public.profiles
    set status          = 'Active',
        membership_plan = v_plan,
        expiry_date     = v_expiry
  where id = v_member;

  -- Owner activity feed — best-effort only. Wrapped so ANY error here (e.g.
  -- schema drift in activity_log) can never block a real approval.
  begin
    select coalesce(m.full_name, m.member_name, 'A member')
      into v_member_name from public.members m where m.id = v_member;

    insert into public.activity_log (gym_owner_id, activity_type, description)
    values (
      v_owner, 'payment',
      coalesce(v_member_name, 'A member') || ' payment of Rs ' || v_amount::text || ' approved (' || coalesce(v_plan, 'plan') || ').'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan);
end;
$$;

-- 2. REJECT — mark the pending payment as rejected. ---------------------------
create or replace function public.reject_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  update public.payments
    set status = 'rejected'
  where id = p_payment_id
    and gym_owner_id = v_owner
    and status = 'pending_verification';

  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found or already processed.');
  end if;
  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.approve_payment(uuid) from public;
revoke all on function public.reject_payment(uuid) from public;
grant execute on function public.approve_payment(uuid) to authenticated;
grant execute on function public.reject_payment(uuid) to authenticated;

-- 3. Realtime so the owner's pending list updates live. -----------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end $$;
