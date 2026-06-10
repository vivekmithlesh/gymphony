-- =====================================================================
-- GYMPHONY — RUN THIS ONCE IN THE SUPABASE SQL EDITOR
-- Paste this whole file into Supabase Dashboard -> SQL Editor -> Run.
-- It is idempotent (safe to re-run). Creates all tables/RLS/realtime
-- the member dashboard needs: attendance, notes, goals, gym coords,
-- reviews realtime, and the realtime publication.
-- =====================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> 20260602_member_owner_realtime.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- Connect Member Dashboard <-> Owner Dashboard + enable realtime.
--   * Ensure gym_settings has the coordinate columns the owner saves and the
--     member needs to render the gym location.
--   * Add the member-facing tables to the supabase_realtime publication so the
--     dashboard updates live.
-- =============================================================================

-- 1. Gym coordinates (owner writes these in SettingsView; member reads them).
alter table public.gym_settings add column if not exists latitude  numeric;
alter table public.gym_settings add column if not exists longitude numeric;

-- 2. Realtime: publish the tables the member dashboard subscribes to.
--    Guarded so it is safe to re-run and skips tables that don't exist.
do $$
declare
  t text;
  tables text[] := array[
    'workout_logs', 'check_ins', 'activity_log',
    'gym_settings', 'gym_profiles', 'member_notes'
  ];
begin
  foreach t in array tables loop
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = t
      )
      and not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      )
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- 3. REPLICA IDENTITY FULL so realtime delivers full old/new rows (needed for
--    DELETE events and reliable filtered subscriptions).
do $$
declare
  t text;
  tables text[] := array['workout_logs', 'check_ins', 'activity_log'];
begin
  foreach t in array tables loop
    if exists (
        select 1 from information_schema.tables
        where table_schema = 'public' and table_name = t
      )
    then
      execute format('alter table public.%I replica identity full', t);
    end if;
  end loop;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> 20260602_check_ins_rls.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> 20260602_member_notes.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- Member Notes — one editable note per day, owned & RW by the member only.
-- Fixes "Failed to fetch notes" (table missing / RLS blocking) and adds the
-- note_date column the new calendar-based editor upserts against.
-- =============================================================================

-- 1. Create the table for fresh installs.
create table if not exists public.member_notes (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null,
  note_date    date not null default current_date,
  note_content text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 2. For existing installs: make sure note_date exists and is backfilled from
--    created_at so historical notes keep their original day.
alter table public.member_notes
  add column if not exists note_date date;

update public.member_notes
  set note_date = (created_at at time zone 'utc')::date
  where note_date is null;

alter table public.member_notes
  alter column note_date set default current_date;

alter table public.member_notes
  alter column note_date set not null;

alter table public.member_notes
  add column if not exists updated_at timestamptz not null default now();

-- 3. Enforce "one note per member per day". Remove any pre-existing duplicates
--    (keep the most recently created) before adding the unique index.
delete from public.member_notes a
using public.member_notes b
where a.member_id = b.member_id
  and a.note_date = b.note_date
  and a.created_at < b.created_at;

create unique index if not exists member_notes_member_date_uniq
  on public.member_notes (member_id, note_date);

-- 4. Row Level Security: a member can fully manage ONLY their own notes.
alter table public.member_notes enable row level security;

drop policy if exists "Members can read their own notes"   on public.member_notes;
drop policy if exists "Members can insert their own notes" on public.member_notes;
drop policy if exists "Members can update their own notes" on public.member_notes;
drop policy if exists "Members can delete their own notes" on public.member_notes;

create policy "Members can read their own notes"
  on public.member_notes for select to authenticated
  using ( auth.uid() = member_id );

create policy "Members can insert their own notes"
  on public.member_notes for insert to authenticated
  with check ( auth.uid() = member_id );

create policy "Members can update their own notes"
  on public.member_notes for update to authenticated
  using ( auth.uid() = member_id )
  with check ( auth.uid() = member_id );

create policy "Members can delete their own notes"
  on public.member_notes for delete to authenticated
  using ( auth.uid() = member_id );


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> 20260602_reviews_realtime.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- Publish reviews for realtime so member ratings/reviews update live everywhere.
do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'reviews')
     and not exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'reviews')
  then
    alter publication supabase_realtime add table public.reviews;
  end if;
end $$;

do $$
begin
  if exists (select 1 from information_schema.tables
             where table_schema = 'public' and table_name = 'reviews')
  then
    alter table public.reviews replica identity full;
  end if;
end $$;


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>> 20260602_member_goals.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<

-- =============================================================================
-- Member Goals — per-member, editable diet & exercise goals (RW by owner only).
-- =============================================================================

create table if not exists public.member_goals (
  id         uuid primary key default gen_random_uuid(),
  member_id  uuid not null,
  category   text not null check (category in ('diet', 'exercise')),
  label      text not null,
  is_done    boolean not null default false,
  position   integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists member_goals_member_cat_idx
  on public.member_goals (member_id, category, position, created_at);

alter table public.member_goals enable row level security;

drop policy if exists "Members manage their own goals" on public.member_goals;
create policy "Members manage their own goals"
  on public.member_goals
  for all
  to authenticated
  using ( auth.uid() = member_id )
  with check ( auth.uid() = member_id );

-- Realtime so a member's goals stay in sync across their devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_goals'
  ) then
    alter publication supabase_realtime add table public.member_goals;
  end if;
end $$;

