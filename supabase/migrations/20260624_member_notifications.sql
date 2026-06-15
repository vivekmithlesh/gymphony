-- =====================================================================
-- 20260624 — Notifications: canonical activity_log schema, RLS, member
-- notifications, and an atomic bulk "mark as read" RPC.
-- =====================================================================
-- WHY: activity_log was created OUT OF BAND (no committed migration ever
-- created it). Every server writer only ever inserts OWNER rows
-- (gym_owner_id); the member dashboard reads/updates by member_id, so the
-- member feed was always empty and "Mark all as read" updated 0 rows and
-- failed silently (the hardening script even calls activity_log inserts
-- "best-effort … schema drift"). This migration:
--   1. Makes activity_log a real, idempotently-defined table with RLS.
--   2. Cleanly separates OWNER rows (gym_owner_id set, member_id null) from
--      MEMBER rows (member_id set, gym_owner_id null) so neither feed leaks
--      into the other.
--   3. Populates member notifications via exception-safe triggers on
--      check_ins and payments (never blocks the underlying write).
--   4. Adds mark_notifications_read(p_ids) — one atomic, auth-scoped bulk
--      update used by BOTH the owner and member dashboards.
--
-- Idempotent and safe to re-run.
-- =====================================================================

-- ---- 1. Canonical table + columns (no-op if it already exists) -------
create table if not exists public.activity_log (
  id            uuid primary key default gen_random_uuid(),
  gym_owner_id  uuid,
  member_id     uuid,
  activity_type text not null,
  description   text,
  is_read       boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Backfill any columns missing on a pre-existing out-of-band table.
alter table public.activity_log add column if not exists gym_owner_id  uuid;
alter table public.activity_log add column if not exists member_id     uuid;
alter table public.activity_log add column if not exists activity_type text;
alter table public.activity_log add column if not exists description   text;
alter table public.activity_log add column if not exists is_read       boolean not null default false;
alter table public.activity_log add column if not exists created_at    timestamptz not null default now();

-- ---- 2. Indexes ------------------------------------------------------
create index if not exists activity_log_member_created_idx on public.activity_log (member_id, created_at desc);
create index if not exists activity_log_owner_created_idx  on public.activity_log (gym_owner_id, created_at desc);

-- ---- 3. RLS ----------------------------------------------------------
alter table public.activity_log enable row level security;

-- Owners see/maintain their own (gym_owner_id) rows.
drop policy if exists activity_log_owner_select on public.activity_log;
create policy activity_log_owner_select on public.activity_log
  for select to authenticated using (gym_owner_id = auth.uid());

drop policy if exists activity_log_owner_update on public.activity_log;
create policy activity_log_owner_update on public.activity_log
  for update to authenticated using (gym_owner_id = auth.uid()) with check (gym_owner_id = auth.uid());

-- Existing owner-side client inserts (dashboard / kiosk / members list) set
-- gym_owner_id to the authenticated owner — keep those working.
drop policy if exists activity_log_owner_insert on public.activity_log;
create policy activity_log_owner_insert on public.activity_log
  for insert to authenticated with check (gym_owner_id = auth.uid());

-- Members see/maintain their own (member_id) rows.
drop policy if exists activity_log_member_select on public.activity_log;
create policy activity_log_member_select on public.activity_log
  for select to authenticated using (member_id = auth.uid());

drop policy if exists activity_log_member_update on public.activity_log;
create policy activity_log_member_update on public.activity_log
  for update to authenticated using (member_id = auth.uid()) with check (member_id = auth.uid());

-- ---- 4. Realtime (member/owner dashboards subscribe to changes) ------
alter table public.activity_log replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.activity_log;
exception
  when duplicate_object then null;
  when undefined_object then null;
end $$;

-- ---- 5. Member notification triggers (exception-safe, never blocking) -
-- Member rows are written with member_id set and gym_owner_id NULL so they
-- never appear in the owner feed (which filters on gym_owner_id).

create or replace function public.fn_notify_member_on_checkin()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into public.activity_log (gym_owner_id, member_id, activity_type, description, is_read, created_at)
    values (
      null,
      new.member_id,
      'check_in',
      case when new.status = 'denied'
           then 'Check-in was denied'
           else 'You checked in successfully' end,
      false,
      coalesce(new.check_in_time, now())
    );
  exception when others then
    null; -- best-effort: a failed activity row must never block a check-in
  end;
  return new;
end $$;

drop trigger if exists trg_notify_member_on_checkin on public.check_ins;
create trigger trg_notify_member_on_checkin
  after insert on public.check_ins
  for each row execute function public.fn_notify_member_on_checkin();

create or replace function public.fn_notify_member_on_payment_approved()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status in ('Success', 'Paid')
     and coalesce(old.status, '') is distinct from new.status then
    begin
      insert into public.activity_log (gym_owner_id, member_id, activity_type, description, is_read, created_at)
      values (
        null,
        new.member_id,
        'payment_approved',
        'Your payment' ||
          case when new.amount is not null then ' of ₹' || trim(to_char(new.amount, 'FM999999990')) else '' end ||
          ' was approved',
        false,
        now()
      );
    exception when others then
      null; -- best-effort
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_member_on_payment_approved on public.payments;
create trigger trg_notify_member_on_payment_approved
  after update on public.payments
  for each row execute function public.fn_notify_member_on_payment_approved();

-- ---- 6. Atomic bulk "mark as read" (owner OR member, auth-scoped) -----
-- p_ids = null  → mark ALL of the caller's unread notifications read.
-- p_ids = [...] → mark just those ids (still scoped to the caller).
create or replace function public.mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  update public.activity_log
     set is_read = true
   where is_read = false
     and (gym_owner_id = auth.uid() or member_id = auth.uid())
     and (p_ids is null or id = any (p_ids));

  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.mark_notifications_read(uuid[]) from public, anon;
grant execute on function public.mark_notifications_read(uuid[]) to authenticated;

notify pgrst, 'reload schema';
