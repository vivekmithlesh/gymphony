-- =============================================================================
-- Attendance (check_ins) — add gym_id for hard multi-tenant isolation.
-- -----------------------------------------------------------------------------
-- B2B requirement: every check-in must carry the gym it belongs to so that
-- real-time subscriptions and queries can be filtered server-side by gym_id,
-- eliminating cross-gym triggers and leaks.
--
-- NOTE: the canonical "gym" entity in this schema is public.gym_settings
-- (members.gym_id, gym_plans.gym_id, reviews.gym_id all reference it). There is
-- no separate "gyms" table, so the FK below references gym_settings(id).
-- Safe to run multiple times.
-- =============================================================================

-- 1. Add the column (nullable so we can backfill existing rows first).
alter table public.check_ins
  add column if not exists gym_id uuid;

-- 2. Backfill historical rows from members (primary), then profiles (fallback) —
--    these mirror the two ownership paths already used by the RLS policy.
update public.check_ins ci
set gym_id = m.gym_id
from public.members m
where ci.gym_id is null
  and ci.member_id = m.id
  and m.gym_id is not null;

update public.check_ins ci
set gym_id = p.gym_id
from public.profiles p
where ci.gym_id is null
  and ci.member_id = p.id
  and p.gym_id is not null;

-- 3. Defensive cleanup: null out any gym_id that does not point at a real gym,
--    so the foreign key can be added without failing on legacy/orphan data.
update public.check_ins ci
set gym_id = null
where ci.gym_id is not null
  and not exists (select 1 from public.gym_settings g where g.id = ci.gym_id);

-- 4. Foreign key to the canonical gym entity. If the gym is deleted, its
--    attendance rows go with it (matches members / gym_plans behaviour).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'check_ins_gym_id_fkey'
  ) then
    -- NOT VALID: create the FK without scanning existing rows (some legacy rows
    -- may carry a stale gym_id). New inserts/updates are still enforced, and the
    -- app only ever writes valid gym_settings ids. Run the optional VALIDATE
    -- below once the data is cleaned if you want full historical enforcement.
    alter table public.check_ins
      add constraint check_ins_gym_id_fkey
      foreign key (gym_id) references public.gym_settings(id) on delete cascade
      not valid;
  end if;
end$$;

-- 5. Index for fast gym-scoped attendance queries (peak hours, live count).
create index if not exists check_ins_gym_id_created_at_idx
  on public.check_ins (gym_id, created_at desc);

-- 5b. Ensure the table is published for Realtime so the gym_id-filtered
--     subscriptions receive events. (INSERT payloads always include gym_id, so
--     REPLICA IDENTITY FULL is not required for the INSERT filters we use.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'check_ins'
  ) then
    alter publication supabase_realtime add table public.check_ins;
  end if;
end$$;

-- -----------------------------------------------------------------------------
-- 6. RLS — re-assert member read-own, and make the OWNER policy gym_id-first.
--    The member-based EXISTS clauses are kept as a fallback so any row whose
--    gym_id has not been backfilled yet is still authorised correctly.
-- -----------------------------------------------------------------------------
alter table public.check_ins enable row level security;

drop policy if exists "Members can view their own check-ins" on public.check_ins;
create policy "Members can view their own check-ins"
  on public.check_ins
  for select
  to authenticated
  using ( auth.uid() = member_id );

drop policy if exists "Owners can manage their gym members' check-ins" on public.check_ins;
create policy "Owners can manage their gym members' check-ins"
  on public.check_ins
  for all
  to authenticated
  using (
    exists (
      select 1 from public.gym_settings g
      where g.id = check_ins.gym_id
        and g.gym_owner_id = auth.uid()
    )
    or exists (
      select 1 from public.members m
      where m.id = check_ins.member_id
        and m.gym_owner_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      join public.gym_settings g on g.id = p.gym_id
      where p.id = check_ins.member_id
        and g.gym_owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.gym_settings g
      where g.id = check_ins.gym_id
        and g.gym_owner_id = auth.uid()
    )
    or exists (
      select 1 from public.members m
      where m.id = check_ins.member_id
        and m.gym_owner_id = auth.uid()
    )
    or exists (
      select 1 from public.profiles p
      join public.gym_settings g on g.id = p.gym_id
      where p.id = check_ins.member_id
        and g.gym_owner_id = auth.uid()
    )
  );
