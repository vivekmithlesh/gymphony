-- =============================================================================
-- Self-serve QR joining — mock online payment gateway
-- -----------------------------------------------------------------------------
-- The self-serve join flow reuses the EXISTING manual-approval rails: a member
-- creates a payments row with status 'pending_verification' (payment_method
-- 'Cash' | 'UPI' | 'Online'), and the owner approves it via the existing
-- approve_payment RPC + OwnerPendingPayments widget. No new approval table.
--
-- This migration adds only the "Pay Online" MOCK: a member can instantly
-- activate their own pending 'Online' payment WITHOUT owner approval — but ONLY
-- when the gym has explicitly opted into mock payments (gym_settings
-- .allow_mock_payments). In production that flag stays false, so the lockdown
-- (20260607) still prevents self-activation. When a real gateway (Razorpay/UPI)
-- is wired up, replace the body of app_simulate_online_payment with real
-- gateway verification and drop the flag check.
--
-- Idempotent; safe to re-run. Depends on app_activate_member (20260607).
-- =============================================================================

-- 1. Per-gym opt-in for the mock gateway. Default OFF — production-safe.
alter table public.gym_settings
  add column if not exists allow_mock_payments boolean not null default false;

-- 2. Member-initiated mock activation of their OWN pending online payment.
create or replace function public.app_simulate_online_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller   uuid := auth.uid();
  v_member   uuid;
  v_gym      uuid;
  v_plan     text;
  v_status   text;
  v_mock     boolean;
  v_duration integer;
  v_expiry   timestamptz;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  -- Lock the payment row and read what we need to authorize + activate.
  select p.member_id, p.gym_id, p.plan_name, p.status
    into v_member, v_gym, v_plan, v_status
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found.');
  end if;

  -- A member may only simulate their OWN payment.
  if v_member <> v_caller then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this payment.');
  end if;

  if v_status = 'Success' then
    return jsonb_build_object('success', true, 'already', true);
  end if;
  if v_status <> 'pending_verification' then
    return jsonb_build_object('success', false, 'error', 'This payment is not awaiting payment.');
  end if;

  -- Mock gateway must be explicitly enabled for this gym (OFF in production).
  select coalesce(g.allow_mock_payments, false) into v_mock
  from public.gym_settings g where g.id = v_gym;
  if not coalesce(v_mock, false) then
    return jsonb_build_object(
      'success', false,
      'error', 'Online payments are not enabled for this gym yet. Choose Pay at Desk.'
    );
  end if;

  -- Resolve the plan's duration (mirrors approve_payment); default 30 days.
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
  v_expiry := now() + make_interval(days => v_duration);

  -- Activate via the single authorized membership writer, then mark the payment
  -- paid. Both run with this function's definer rights, so the lockdown trigger
  -- permits the profiles write (app_activate_member sets the allow flag).
  perform public.app_activate_member(v_member, v_plan, v_expiry);
  update public.payments set status = 'Success' where id = p_payment_id;

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan);
end;
$$;

revoke all on function public.app_simulate_online_payment(uuid) from public;
grant execute on function public.app_simulate_online_payment(uuid) to authenticated;
