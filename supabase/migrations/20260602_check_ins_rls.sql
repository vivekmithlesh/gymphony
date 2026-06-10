-- =============================================================================
-- Attendance (check_ins) — schema safety + READ-ONLY member access via RLS
-- -----------------------------------------------------------------------------
-- The gym OWNER / KIOSK writes attendance into public.check_ins
-- (see AttendanceView.tsx, KioskMode.tsx). Members must be able to READ ONLY
-- their own rows and never insert/update/delete. RLS enforces this at the DB.
-- =============================================================================

-- 1. Ensure the table exists with the columns the app already uses.
--    (If it already exists this is a no-op and will NOT alter your columns.)
create table if not exists public.check_ins (
  id            uuid primary key default gen_random_uuid(),
  member_id     uuid not null,
  status        text not null default 'granted',  -- 'granted' | 'denied'
  check_in_time timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

-- 2. Fast lookups for "my recent attendance".
create index if not exists check_ins_member_id_created_at_idx
  on public.check_ins (member_id, created_at desc);

-- 3. Lock the table down. With RLS on, every access is denied unless a policy
--    below explicitly allows it.
alter table public.check_ins enable row level security;

-- -----------------------------------------------------------------------------
-- MEMBER  —  READ ONLY, own rows only.
-- There is intentionally NO insert/update/delete policy for members, so the
-- DB will reject any write a member attempts, no matter what the client sends.
-- -----------------------------------------------------------------------------
drop policy if exists "Members can view their own check-ins" on public.check_ins;
create policy "Members can view their own check-ins"
  on public.check_ins
  for select
  to authenticated
  using ( auth.uid() = member_id );

-- -----------------------------------------------------------------------------
-- OWNER  —  full management of attendance for members of a gym they own.
-- A member belongs to an owner when members.gym_owner_id = auth.uid()
-- (fallback: profiles.gym_id -> gym_settings.id where gym_settings.gym_owner_id
-- = auth.uid()). Required so that enabling RLS does not break owner/kiosk marking.
-- -----------------------------------------------------------------------------
drop policy if exists "Owners can manage their gym members' check-ins" on public.check_ins;
create policy "Owners can manage their gym members' check-ins"
  on public.check_ins
  for all
  to authenticated
  using (
    exists (
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
