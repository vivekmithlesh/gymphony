create extension if not exists pgcrypto;

create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references public.profiles(id) on delete cascade,
  gym_id uuid not null references public.gym_settings(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text not null,
  created_at timestamptz not null default now()
);

create index if not exists reviews_gym_id_created_at_idx
  on public.reviews (gym_id, created_at desc);

create index if not exists reviews_member_id_idx
  on public.reviews (member_id);

alter table public.reviews enable row level security;

drop policy if exists "reviews_select_authenticated" on public.reviews;
create policy "reviews_select_authenticated"
  on public.reviews
  for select
  to authenticated
  using (true);

drop policy if exists "reviews_insert_authenticated" on public.reviews;
create policy "reviews_insert_authenticated"
  on public.reviews
  for insert
  to authenticated
  with check (auth.uid() = member_id);

drop policy if exists "reviews_update_own" on public.reviews;
create policy "reviews_update_own"
  on public.reviews
  for update
  to authenticated
  using (auth.uid() = member_id)
  with check (auth.uid() = member_id);

drop policy if exists "reviews_delete_own" on public.reviews;
create policy "reviews_delete_own"
  on public.reviews
  for delete
  to authenticated
  using (auth.uid() = member_id);
