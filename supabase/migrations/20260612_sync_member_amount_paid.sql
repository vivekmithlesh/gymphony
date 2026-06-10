-- =============================================================================
-- Reconcile profiles.amount_paid with the approved-payments ledger.
-- -----------------------------------------------------------------------------
-- The denormalized profiles.amount_paid column is read by the "Amount Paid"
-- column (MembersList), Pending Dues (dashboard.tsx) and parts of Revenue. It
-- was bumped ad-hoc by the owner "Collect Payment" / "Mark Paid" flows and held
-- stale test data (e.g. ₹101,000) that never matched the payments table.
--
-- The payments ledger is the single source of truth for realized revenue, and
-- ONLY approved rows (status Paid/Success) count — pending_verification /
-- rejected never do (mirrors src/lib/revenue.ts isApprovedPayment).
--
-- This migration:
--   1. installs a function that recomputes one member's amount_paid from their
--      approved payments,
--   2. installs an AFTER trigger on payments so any insert/update/delete (incl.
--      approve_payment flipping a UPI row to 'Success') keeps amount_paid in
--      sync — the column can never drift from the ledger again, and
--   3. back-fills every existing member once, clearing stale test data.
--
-- amount_paid is NOT one of the protected columns in 20260607's membership
-- lockdown trigger, so these owner-less, definer-context updates pass cleanly.
--
-- Idempotent; safe to re-run. Apply AFTER 20260606_payments_rls (needs the
-- ledger's final shape) and 20260607_membership_column_lockdown.
-- =============================================================================

begin;

-- 0. Guarantee the column exists before anything references it. -----------------
--    The app reads profiles.amount_paid, but this repo has a history of live
--    schema drift (e.g. profiles was missing subscription_status). Without this
--    guard a missing column would abort the whole transaction. numeric + default
--    0 so the back-fill and trigger always have a valid target.
alter table public.profiles
  add column if not exists amount_paid numeric not null default 0;

-- 1. Recompute a single member's amount_paid from approved payments. -----------
create or replace function public.app_sync_member_amount_paid(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member is null then
    return;
  end if;

  update public.profiles p
     set amount_paid = coalesce((
       select sum(pay.amount)
       from public.payments pay
       where pay.member_id = p_member
         and lower(trim(coalesce(pay.status, ''))) in ('paid', 'success')
     ), 0)
   where p.id = p_member;
end;
$$;

-- 2. Resync the affected member(s) after any payments change. -------------------
create or replace function public.app_payments_resync_amount_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.app_sync_member_amount_paid(old.member_id);
    return null;
  end if;

  -- INSERT or UPDATE
  perform public.app_sync_member_amount_paid(new.member_id);

  -- A payment re-pointed to a different member: resync the old one too.
  if tg_op = 'UPDATE' and old.member_id is distinct from new.member_id then
    perform public.app_sync_member_amount_paid(old.member_id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payments_resync_amount_paid on public.payments;
create trigger trg_payments_resync_amount_paid
  after insert or update or delete on public.payments
  for each row execute function public.app_payments_resync_amount_paid();

-- 3. One-time back-fill for every existing member (clears stale test data). -----
update public.profiles p
   set amount_paid = coalesce((
     select sum(pay.amount)
     from public.payments pay
     where pay.member_id = p.id
       and lower(trim(coalesce(pay.status, ''))) in ('paid', 'success')
   ), 0);

commit;
