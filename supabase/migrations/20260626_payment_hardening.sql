-- =====================================================================
-- 20260626 — Payment hardening (Phase 1, manual UPI): UTR capture +
-- duplicate-UTR prevention, evidence upload, full audit trail, and
-- closing the mock self-activation hatch.
-- =====================================================================
-- Builds on the existing manual-UPI rails (members insert a
-- 'pending_verification' payments row; owner approves via approve_payment).
-- The member-insert RLS policy already pins status to 'pending_verification'
-- and member_id to self, so a member can never self-mark a payment paid.
-- This migration adds the verification ASSETS and AUDIT around that flow:
--   • payments.utr           — the UPI reference number the member enters.
--   • payments.evidence_url  — optional screenshot proof.
--   • UNIQUE(lower(utr))     — the same UTR can never be submitted twice.
--   • payment_audit          — append-only trail of every status transition.
--   • mock hatch gated GLOBALLY — app_simulate_online_payment now also needs a
--     server-side app_config flag, so "subscriptions never activate without
--     verification" holds even if a gym left allow_mock_payments on.
--
-- Idempotent; safe to re-run. Depends on app_config (20260625).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Columns: UTR + evidence
-- ---------------------------------------------------------------------
alter table public.payments add column if not exists utr          text;
alter table public.payments add column if not exists evidence_url text;

-- ---------------------------------------------------------------------
-- 2. Duplicate-UTR prevention. A UPI UTR is globally unique per real
--    transaction, so the same reference must never appear twice. Partial,
--    case-insensitive index (cash / blank-UTR rows are exempt).
-- ---------------------------------------------------------------------
create unique index if not exists payments_utr_unique_idx
  on public.payments (lower(utr))
  where utr is not null and btrim(utr) <> '';

-- ---------------------------------------------------------------------
-- 3. Full audit trail — append-only record of every payment transition.
-- ---------------------------------------------------------------------
create table if not exists public.payment_audit (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null,
  gym_owner_id uuid,
  member_id    uuid,
  actor        uuid,            -- auth.uid() that caused the change
  action       text not null,   -- submitted | approved | rejected | status_changed
  old_status   text,
  new_status   text,
  utr          text,
  amount       numeric,
  note         text,
  created_at   timestamptz not null default now()
);
create index if not exists payment_audit_owner_created_idx on public.payment_audit (gym_owner_id, created_at desc);
create index if not exists payment_audit_payment_idx       on public.payment_audit (payment_id, created_at desc);

alter table public.payment_audit enable row level security;
-- Owners read their own gym's trail; nobody writes it directly (trigger only).
drop policy if exists payment_audit_owner_select on public.payment_audit;
create policy payment_audit_owner_select on public.payment_audit
  for select to authenticated using (gym_owner_id = auth.uid());

-- Trigger captures EVERY path (member submit, owner approve/reject, RPCs),
-- independent of which code wrote the row. Exception-safe: an audit failure
-- must never block a real payment.
create or replace function public.fn_payment_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.payment_audit (payment_id, gym_owner_id, member_id, actor, action, old_status, new_status, utr, amount)
      values (new.id, new.gym_owner_id, new.member_id, auth.uid(), 'submitted', null, new.status, new.utr, new.amount);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := case
        when new.status in ('Success', 'Paid') then 'approved'
        when new.status = 'rejected'            then 'rejected'
        else 'status_changed'
      end;
      insert into public.payment_audit (payment_id, gym_owner_id, member_id, actor, action, old_status, new_status, utr, amount)
      values (new.id, new.gym_owner_id, new.member_id, auth.uid(), v_action, old.status, new.status, new.utr, new.amount);
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

drop trigger if exists trg_payment_audit on public.payments;
create trigger trg_payment_audit
  after insert or update on public.payments
  for each row execute function public.fn_payment_audit();

-- ---------------------------------------------------------------------
-- 4. Close the mock self-activation hatch GLOBALLY. Even with a gym's
--    allow_mock_payments on, activation now also requires a server-side
--    app_config flag that defaults OFF. In production this stays off, so a
--    membership can only activate via approve_payment (owner-verified) or a
--    real verified gateway webhook — never by the member alone.
-- ---------------------------------------------------------------------
insert into public.app_config (key, value)
values ('mock_payments_enabled', 'false')
on conflict (key) do nothing;

create or replace function public.app_simulate_online_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller     uuid := auth.uid();
  v_member     uuid;
  v_gym        uuid;
  v_plan       text;
  v_status     text;
  v_mock       boolean;
  v_global     boolean;
  v_duration   integer;
  v_expiry     timestamptz;
begin
  if v_caller is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  -- GLOBAL kill-switch (defaults off). Production-safe regardless of per-gym flag.
  select (value = 'true') into v_global from public.app_config where key = 'mock_payments_enabled';
  if not coalesce(v_global, false) then
    return jsonb_build_object('success', false,
      'error', 'Online auto-payment is disabled. Your membership activates once the gym verifies your payment.');
  end if;

  select p.member_id, p.gym_id, p.plan_name, p.status
    into v_member, v_gym, v_plan, v_status
  from public.payments p
  where p.id = p_payment_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found.');
  end if;
  if v_member <> v_caller then
    return jsonb_build_object('success', false, 'error', 'Not authorized for this payment.');
  end if;
  if v_status = 'Success' then
    return jsonb_build_object('success', true, 'already', true);
  end if;
  if v_status <> 'pending_verification' then
    return jsonb_build_object('success', false, 'error', 'This payment is not awaiting payment.');
  end if;

  select coalesce(g.allow_mock_payments, false) into v_mock
  from public.gym_settings g where g.id = v_gym;
  if not coalesce(v_mock, false) then
    return jsonb_build_object('success', false,
      'error', 'Online payments are not enabled for this gym yet. Choose Pay at Desk.');
  end if;

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

  perform public.app_activate_member(v_member, v_plan, v_expiry);
  update public.payments set status = 'Success' where id = p_payment_id;

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan);
end;
$$;

revoke all on function public.app_simulate_online_payment(uuid) from public, anon;
grant execute on function public.app_simulate_online_payment(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Evidence storage bucket (best-effort; payment hardening must not fail
--    if storage DDL is restricted in this environment).
-- ---------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public)
  values ('payment-evidence', 'payment-evidence', true)
  on conflict (id) do nothing;

  begin execute 'drop policy if exists "payment_evidence_insert" on storage.objects'; exception when others then null; end;
  begin
    execute $p$
      create policy "payment_evidence_insert" on storage.objects
        for insert to authenticated
        with check (bucket_id = 'payment-evidence' and (storage.foldername(name))[1] = auth.uid()::text)
    $p$;
  exception when others then null; end;
exception when others then null;
end $$;

notify pgrst, 'reload schema';
