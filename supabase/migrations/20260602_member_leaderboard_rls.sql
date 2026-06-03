-- =============================================================================
-- Member Leaderboard — let a member READ their gym-mates (and their workout
-- logs) so the gym-scoped leaderboard can rank everyone in the same gym.
-- -----------------------------------------------------------------------------
-- These are ADDITIVE select policies. We intentionally do NOT call
-- `enable row level security` here: if RLS is already on, owners keep their
-- existing policies and members gain same-gym read; if RLS is off, these
-- policies are simply inert and existing reads keep working. Either way this
-- migration cannot lock anyone out.
-- =============================================================================

-- Helper: the caller's gym_id, resolved with SECURITY DEFINER so it bypasses
-- RLS on members/profiles. This avoids the infinite-recursion trap you hit when
-- a policy ON members has to SELECT FROM members to find the caller's gym.
create or replace function public.current_member_gym_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select gym_id from public.members  where id = auth.uid() limit 1),
    (select gym_id from public.profiles where id = auth.uid() limit 1)
  );
$$;

grant execute on function public.current_member_gym_id() to authenticated;

-- members: a member may read fellow members of the same gym.
-- NOTE: public.members is a VIEW in this database, and Postgres rejects RLS
-- policies on views ("members is not a table"). A view already runs under its
-- own (definer) security, so same-gym reads work without a policy. We only
-- create the policy if members is an ordinary table (relkind 'r').
do $$
begin
  if exists (
    select 1 from pg_class
    where relname = 'members' and relnamespace = 'public'::regnamespace and relkind = 'r'
  ) then
    drop policy if exists "Members can view gym-mates" on public.members;
    create policy "Members can view gym-mates"
      on public.members
      for select
      to authenticated
      using ( gym_id = public.current_member_gym_id() );
  end if;
end $$;

-- profiles: read the name/avatar of same-gym members (plus always your own row).
drop policy if exists "Members can view gym-mate profiles" on public.profiles;
create policy "Members can view gym-mate profiles"
  on public.profiles
  for select
  to authenticated
  using ( id = auth.uid() or gym_id = public.current_member_gym_id() );

-- workout_logs: read every log for your own gym so calories can be aggregated.
drop policy if exists "Members can view gym workout logs" on public.workout_logs;
create policy "Members can view gym workout logs"
  on public.workout_logs
  for select
  to authenticated
  using ( gym_id = public.current_member_gym_id() );

-- Realtime + full row payloads for the leaderboard subscription (guarded).
-- Only real tables can be added to a publication, so skip if members is a view.
do $$
begin
  if exists (
       select 1 from pg_class
       where relname = 'members' and relnamespace = 'public'::regnamespace and relkind = 'r'
     )
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'members'
     )
  then
    execute 'alter publication supabase_realtime add table public.members';
  end if;
end $$;
