-- =============================================================================
-- (a) PAYMENTS — schema reconcile + Row-Level Security lockdown.
-- -----------------------------------------------------------------------------
-- Live facts (verified in Supabase, 2026-06-06):
--   • payments columns are: id, member_id, amount, payment_method, status,
--     created_at, gym_owner_id  — it is MISSING gym_id, plan_name, payment_date
--     that the app (MemberUpiCheckout/MembersList) inserts and approve_payment
--     reads. So step 1 reconciles that drift.
--   • payments is EMPTY (no back-fill needed).
--   • payments already had RLS enabled + pre-existing policies; step 4 REPLACES
--     them with a vetted set so an unknown permissive policy can't undercut the
--     lockdown. (If any old policy is load-bearing, fold it in before running.)
--
-- After this: a member may only read their own payments and only INSERT a
-- 'pending_verification' row for themselves — never 'Success'/'Paid'. Owners get
-- full access to their gym's payments. approve_payment/reject_payment are
-- SECURITY DEFINER and bypass RLS, so approval is unaffected.
--
-- Idempotent; safe to re-run. Apply BEFORE 20260607_membership_column_lockdown
-- (that migration's approve_payment references the columns added here).
-- =============================================================================

begin;

-- 1. Reconcile schema drift — add the columns the app/RPC already use. ---------
alter table public.payments add column if not exists gym_id       uuid;
alter table public.payments add column if not exists plan_name    text;
alter table public.payments add column if not exists payment_date timestamptz default now();

-- 2. Auto-fill gym_owner_id / gym_id on INSERT when the client omits them. -----
--    The owner "record payment" path (MembersList.tsx) sends neither; we derive
--    them from the `members` view (profiles ⋈ gym_settings). BEFORE INSERT fires
--    before the RLS WITH CHECK, so the filled gym_owner_id is what the owner
--    policy sees. If the member isn't found we leave the row as-is (RLS decides).
create or replace function public.app_fill_payment_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_gym   uuid;
begin
  if new.gym_owner_id is null or new.gym_id is null then
    select m.gym_owner_id, m.gym_id
      into v_owner, v_gym
    from public.members m
    where m.id = new.member_id;

    if found then
      new.gym_owner_id := coalesce(new.gym_owner_id, v_owner);
      new.gym_id       := coalesce(new.gym_id, v_gym);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_payment_owner on public.payments;
create trigger trg_fill_payment_owner
  before insert on public.payments
  for each row execute function public.app_fill_payment_owner();

-- 3. Ensure RLS is on (it already is; harmless if re-run). ---------------------
alter table public.payments enable row level security;

-- 4. Replace ALL existing payments policies with a vetted set. -----------------
--    Drops whatever is currently there (the pre-existing ~6) so the lockdown is
--    deterministic and can't be undercut by an unknown permissive policy.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'payments'
  loop
    execute format('drop policy if exists %I on public.payments', pol.policyname);
  end loop;
end $$;

-- Member: read only your own payments.
create policy payments_member_select on public.payments
  for select to authenticated
  using (member_id = auth.uid());

-- Member: insert ONLY a pending UPI payment for yourself. This is the line that
-- kills the self-activation bug: status is pinned to 'pending_verification' and
-- member_id to self, so a member can never write 'Success'/'Paid'.
create policy payments_member_insert on public.payments
  for insert to authenticated
  with check (
    member_id = auth.uid()
    and status = 'pending_verification'
  );

-- Owner: full access to payments for gyms you own.
create policy payments_owner_all on public.payments
  for all to authenticated
  using (gym_owner_id = auth.uid())
  with check (gym_owner_id = auth.uid());

commit;
