-- =============================================================================
-- (b) MEMBERSHIP COLUMN LOCKDOWN — stop members granting themselves a plan.
-- -----------------------------------------------------------------------------
-- `members` is a VIEW over `profiles` (joined to gym_settings only to surface
-- gym_owner_id), so the base table — and the only place a BEFORE trigger can
-- live — is `profiles`. profiles holds status, membership_plan,
-- subscription_status, subscription_end_date AND expiry_date.
--
-- The hole: MemberActivePlans.tsx writes profiles directly from the member's own
-- session (status='Active', subscription_end_date, membership_plan, …). profiles
-- has NO RLS (and broad grants), so without this a member can self-activate.
--
-- The trigger allows a change to the protected columns ONLY when the gym's OWNER
-- makes it (verified against gym_settings) or when the authorized activation RPC
-- sets a transaction-local flag. This permits every legitimate writer:
--   • Owner auto-expiry (dashboard.tsx) + activate (MembersList.tsx) — owner of
--     the row's gym, so allowed. Also covers the cross-member case the naive
--     "is it your own row" check would have missed.
--   • app_activate_member (below) — sets the flag.
--   • Member self-edits of name/phone/avatar — not protected columns, untouched.
--   • Owner SaaS billing — writes gym_settings, not profiles.
--
-- The `app.` flag is set only inside our SECURITY DEFINER functions; PostgREST
-- clients can't issue a bare SET before an UPDATE, so it can't be spoofed.
--
-- Idempotent; safe to re-run. Apply AFTER 20260606_payments_rls (payments needs
-- its gym_id/plan_name columns before approve_payment references them).
-- =============================================================================

begin;

-- 1. The single authorized writer of membership columns. ----------------------
--    Writes the base table `profiles` (the `members` view isn't updatable — it
--    has a join). Sets both subscription_end_date and expiry_date since the view
--    surfaces COALESCE(subscription_end_date, expiry_date). NOT granted to members.
create or replace function public.app_activate_member(
  p_member uuid,
  p_plan   text,
  p_expiry timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.allow_membership_write', 'on', true);

  update public.profiles
     set status                = 'Active',
         subscription_status   = 'Active',
         membership_plan       = coalesce(p_plan, membership_plan),
         subscription_end_date = p_expiry,
         expiry_date           = p_expiry
   where id = p_member;
end;
$$;

revoke all on function public.app_activate_member(uuid, text, timestamptz) from public;
revoke all on function public.app_activate_member(uuid, text, timestamptz) from anon, authenticated;

-- 2. The lockdown trigger function (on profiles). -----------------------------
--    Compares OLD/NEW as jsonb so it only checks protected keys that exist.
--    A protected-column change is allowed iff the flag is set OR the caller owns
--    the gym the row belongs to (gym_settings.id = profiles.gym_id).
create or replace function public.app_lock_membership_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  protected text[] := array[
    'status', 'membership_plan',
    'subscription_status', 'subscription_end_date', 'expiry_date'
  ];
  col        text;
  newj       jsonb := to_jsonb(new);
  oldj       jsonb := to_jsonb(old);
  v_changed  boolean := false;
begin
  -- Authorized server path (app_activate_member / future verified webhook).
  if coalesce(current_setting('app.allow_membership_write', true), '') = 'on' then
    return new;
  end if;

  -- Did any protected column actually change? If not, it's a plain profile edit.
  foreach col in array protected loop
    if (newj ? col) and ((newj->>col) is distinct from (oldj->>col)) then
      v_changed := true;
      exit;
    end if;
  end loop;
  if not v_changed then
    return new;
  end if;

  -- A protected change is only allowed by the OWNER of the row's gym.
  if auth.uid() is not null and exists (
    select 1
    from public.gym_settings gs
    where gs.id = new.gym_id
      and gs.gym_owner_id = auth.uid()
  ) then
    return new;
  end if;

  raise exception
    'Membership status/plan/expiry can only be changed by the gym owner (after a verified payment).'
    using errcode = 'check_violation';
end;
$$;

-- 3. Attach to profiles only (members is a view; INSERTs at signup are fine). --
drop trigger if exists trg_lock_membership_cols on public.profiles;
create trigger trg_lock_membership_cols
  before update on public.profiles
  for each row execute function public.app_lock_membership_columns();

-- 4. Route owner approval through the chokepoint. -----------------------------
--    Same shape as 20260605_payment_verification, but activation now goes via
--    app_activate_member (sets the flag, writes profiles) and the gym used for
--    plan-duration lookup comes from payments.gym_id (added in 20260606).
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

  select coalesce(gp.duration_days, gp.duration * 30, 30)
    into v_duration
  from public.gym_plans gp
  where gp.gym_id = v_gym and (gp.name = v_plan or gp.plan_name = v_plan)
  order by gp.created_at desc
  limit 1;
  if v_duration is null then v_duration := 30; end if;
  v_expiry := now() + make_interval(days => v_duration);

  update public.payments set status = 'Success' where id = p_payment_id;

  -- Activate via the single authorized writer (sets the lockdown flag).
  perform public.app_activate_member(v_member, v_plan, v_expiry);

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

commit;
