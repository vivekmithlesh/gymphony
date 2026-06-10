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
