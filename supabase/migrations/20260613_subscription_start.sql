-- =============================================================================
-- SUBSCRIPTION START — record when the current membership began.
-- -----------------------------------------------------------------------------
-- profiles already holds expiry_date (the membership END). There was no recorded
-- START, so the member dashboard had to derive it (expiry − plan duration) or
-- borrow the gym-join date (created_at) — which read as a "false" join date on
-- the Subscription card. This adds an explicit subscription_start, written at the
-- moment a plan is activated, so the card shows a real fact instead of a guess.
--
-- subscription_start is a PROTECTED membership column: only the gym owner or the
-- authorized activation RPC (app_activate_member, which sets the lockdown flag)
-- may write it — same guard as status/expiry_date (see 20260607).
--
-- Idempotent; safe to re-run. Apply AFTER 20260607_membership_column_lockdown.
-- =============================================================================

begin;

-- 1. The column. --------------------------------------------------------------
alter table public.profiles add column if not exists subscription_start timestamptz;

-- 2. Set it at activation. The activation moment IS the start; renewals reset it
--    to "now" alongside the fresh expiry. Still sets the lockdown flag so the
--    BEFORE-UPDATE trigger permits the protected-column writes.
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
         subscription_start    = now(),
         subscription_end_date = p_expiry,
         expiry_date           = p_expiry
   where id = p_member;
end;
$$;

revoke all on function public.app_activate_member(uuid, text, timestamptz) from public;
revoke all on function public.app_activate_member(uuid, text, timestamptz) from anon, authenticated;

-- 3. Add subscription_start to the lockdown trigger's protected columns so a
--    member can't forge their own start date by writing profiles directly.
create or replace function public.app_lock_membership_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  protected text[] := array[
    'status', 'membership_plan',
    'subscription_status', 'subscription_start', 'subscription_end_date', 'expiry_date'
  ];
  col        text;
  newj       jsonb := to_jsonb(new);
  oldj       jsonb := to_jsonb(old);
  v_changed  boolean := false;
begin
  if coalesce(current_setting('app.allow_membership_write', true), '') = 'on' then
    return new;
  end if;

  foreach col in array protected loop
    if (newj ? col) and ((newj->>col) is distinct from (oldj->>col)) then
      v_changed := true;
      exit;
    end if;
  end loop;
  if not v_changed then
    return new;
  end if;

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

-- 4. Backfill: use the latest successful payment as the start for existing
--    members. Covers both the member UPI flow ('Success') and the owner
--    Mark-Paid flow ('Paid'). Only fills rows that have no start yet.
--
--    The lockdown trigger (app_lock_membership_columns) would reject this UPDATE:
--    run from the SQL editor / migration there is no auth.uid() (so the owner
--    check fails) and no app.allow_membership_write flag. subscription_start IS a
--    protected column, so the guard raises. We disable the trigger for just this
--    one administrative backfill, then re-enable it. Both ALTERs and the UPDATE
--    are inside this transaction, so a failure rolls all of it back together —
--    the trigger can never be left disabled.
alter table public.profiles disable trigger trg_lock_membership_cols;

update public.profiles p
   set subscription_start = sub.started_at
  from (
    select member_id, max(coalesce(payment_date, created_at)) as started_at
    from public.payments
    where status in ('Success', 'Paid')
    group by member_id
  ) sub
 where p.id = sub.member_id
   and p.subscription_start is null;

alter table public.profiles enable trigger trg_lock_membership_cols;

commit;
