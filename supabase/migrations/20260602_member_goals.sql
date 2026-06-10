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
