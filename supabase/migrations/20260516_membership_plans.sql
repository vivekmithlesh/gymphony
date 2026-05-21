create extension if not exists pgcrypto;

create table if not exists public.membership_plans (
  id uuid primary key default gen_random_uuid(),
  gym_id uuid not null references public.gym_settings(id) on delete cascade,
  gym_owner_id uuid references public.profiles(id) on delete cascade,
  name text not null,
  plan_name text,
  price numeric(12,2) not null default 0,
  duration integer not null default 1,
  features text[] default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_plans_gym_id_idx
  on public.membership_plans (gym_id);

create index if not exists membership_plans_owner_idx
  on public.membership_plans (gym_owner_id);

alter table public.membership_plans enable row level security;

drop policy if exists "membership_plans_select_authenticated" on public.membership_plans;
create policy "membership_plans_select_authenticated"
  on public.membership_plans
  for select
  to authenticated
  using (true);

drop policy if exists "membership_plans_insert_owner" on public.membership_plans;
create policy "membership_plans_insert_owner"
  on public.membership_plans
  for insert
  to authenticated
  with check (auth.uid() = gym_owner_id);

drop policy if exists "membership_plans_update_owner" on public.membership_plans;
create policy "membership_plans_update_owner"
  on public.membership_plans
  for update
  to authenticated
  using (auth.uid() = gym_owner_id)
  with check (auth.uid() = gym_owner_id);

drop policy if exists "membership_plans_delete_owner" on public.membership_plans;
create policy "membership_plans_delete_owner"
  on public.membership_plans
  for delete
  to authenticated
  using (auth.uid() = gym_owner_id);
