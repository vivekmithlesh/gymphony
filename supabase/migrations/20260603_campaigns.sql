-- =============================================================================
-- Campaigns — Step 2 of the Inventory & Campaigns system.
-- Owner-created promotional offers surfaced in the Member App store. Two kinds:
--   target_type = 'global'  → store-wide sale for every member (e.g. Diwali)
--   target_type = 'streak'  → unlocks only for members with a 30+ day streak
-- `applies_to` is 'All' or a product category ('Supplements' | 'Drinks' | 'Gear').
--
-- Idempotent; safe on fresh OR existing installs.
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id                  uuid primary key default gen_random_uuid(),
  gym_owner_id        uuid not null references auth.users (id) on delete cascade,
  name                text not null,
  discount_percentage numeric not null default 0 check (discount_percentage >= 0 and discount_percentage <= 100),
  target_type         text not null default 'global' check (target_type in ('global', 'streak')),
  applies_to          text not null default 'All',
  is_active           boolean not null default true,
  ends_at             timestamptz,  -- null = runs until manually ended
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Existing installs: ensure every column exists.
alter table public.campaigns add column if not exists gym_owner_id        uuid;
alter table public.campaigns add column if not exists name                text;
alter table public.campaigns add column if not exists discount_percentage numeric default 0;
alter table public.campaigns add column if not exists target_type         text default 'global';
alter table public.campaigns add column if not exists applies_to          text default 'All';
alter table public.campaigns add column if not exists is_active           boolean default true;
alter table public.campaigns add column if not exists ends_at             timestamptz;
alter table public.campaigns add column if not exists created_at          timestamptz default now();
alter table public.campaigns add column if not exists updated_at          timestamptz default now();

create index if not exists campaigns_gym_owner_id_idx on public.campaigns (gym_owner_id);
create index if not exists campaigns_active_idx on public.campaigns (gym_owner_id, is_active);

-- 2. Row Level Security --------------------------------------------------------
alter table public.campaigns enable row level security;

drop policy if exists "Owners read their own campaigns"   on public.campaigns;
drop policy if exists "Owners insert their own campaigns"  on public.campaigns;
drop policy if exists "Owners update their own campaigns"  on public.campaigns;
drop policy if exists "Owners delete their own campaigns"  on public.campaigns;

create policy "Owners read their own campaigns"
  on public.campaigns for select to authenticated
  using ( auth.uid() = gym_owner_id );

create policy "Owners insert their own campaigns"
  on public.campaigns for insert to authenticated
  with check ( auth.uid() = gym_owner_id );

create policy "Owners update their own campaigns"
  on public.campaigns for update to authenticated
  using ( auth.uid() = gym_owner_id )
  with check ( auth.uid() = gym_owner_id );

create policy "Owners delete their own campaigns"
  on public.campaigns for delete to authenticated
  using ( auth.uid() = gym_owner_id );

-- NOTE: the member-facing "read active campaigns for my gym" SELECT policy is
-- added in Step 3 (Member Storefront), alongside the member→gym join.

-- 3. Realtime ------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.campaigns;
exception
  when duplicate_object then null;
end $$;
