-- =============================================================================
-- MEMBER GOAL — DAILY COMPLETIONS
-- -----------------------------------------------------------------------------
-- Diet/Exercise goals are *daily* checklists: the label is a recurring intention
-- ("Drink 3L water") that persists, but the CHECKED state must reset every day at
-- the member's local midnight so they get a fresh list each morning.
--
-- The original schema stored `is_done` directly on member_goals, which conflated
-- the goal DEFINITION with TODAY's completion — so a goal ticked yesterday stayed
-- ticked forever. This splits the two:
--
--   * member_goals             → the definition (label/position) — persists.
--   * member_goal_completions  → one row per (goal, calendar day) it was done.
--
-- A goal is "done today" iff a completion row exists for today's LOCAL date. No
-- nightly job is needed: at local midnight the date advances, yesterday's rows no
-- longer match, and the checklist is fresh — while every past day stays recorded
-- as durable history (streaks, adherence reports, etc.).
--
-- `completed_on` is the member's LOCAL date, supplied by the client (the browser
-- knows the member's timezone). We deliberately do NOT use CURRENT_DATE here,
-- because that is the database server's date (UTC on Supabase) and would roll over
-- at the wrong moment for anyone not on UTC.
--
-- Idempotent; safe to re-run. Apply AFTER 20260602_member_goals.
-- =============================================================================

begin;

create table if not exists public.member_goal_completions (
  id           uuid primary key default gen_random_uuid(),
  goal_id      uuid not null references public.member_goals(id) on delete cascade,
  member_id    uuid not null,
  completed_on date not null,
  created_at   timestamptz not null default now(),
  -- A goal can only be "done" once per calendar day. Toggling off deletes the row,
  -- toggling on re-inserts it; this unique key makes the upsert race-safe.
  unique (goal_id, completed_on)
);

-- Today's-checklist read path: "all of THIS member's completions for THIS date".
create index if not exists member_goal_completions_member_day_idx
  on public.member_goal_completions (member_id, completed_on);

-- Per-goal history path: "every day goal X was completed" (streaks/adherence).
create index if not exists member_goal_completions_goal_idx
  on public.member_goal_completions (goal_id, completed_on);

alter table public.member_goal_completions enable row level security;

drop policy if exists "Members manage their own goal completions" on public.member_goal_completions;
create policy "Members manage their own goal completions"
  on public.member_goal_completions
  for all
  to authenticated
  using ( auth.uid() = member_id )
  with check ( auth.uid() = member_id );

-- Realtime so a tick on one device clears/sets on the member's other devices.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'member_goal_completions'
  ) then
    alter publication supabase_realtime add table public.member_goal_completions;
  end if;
end $$;

-- Backfill: preserve the single most recent state we have. Any goal currently
-- flagged is_done is treated as "completed today" so the migration doesn't visibly
-- wipe a member's in-progress checklist the moment it ships. (Historical days
-- before this migration were never recorded, so there is nothing earlier to keep.)
insert into public.member_goal_completions (goal_id, member_id, completed_on)
select g.id, g.member_id, (now() at time zone 'utc')::date
from public.member_goals g
where g.is_done = true
on conflict (goal_id, completed_on) do nothing;

-- `is_done` is now derived from completions and no longer read by the app. It is
-- left in place (not dropped) so this migration stays reversible and any external
-- reader doesn't break; the column is simply ignored going forward.

commit;
