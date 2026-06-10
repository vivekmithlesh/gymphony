-- =============================================================================
-- Inventory / Gym Store products — Step 1 of the Inventory & Campaigns system.
-- Provisions the `inventory` table (owner-managed gym store products), its RLS
-- policies, the `inventory-items` storage bucket for product images, and adds
-- the table to the realtime publication so the owner's grid updates live.
--
-- Why: the Inventory Manager showed "No products found" because the table/bucket
-- /RLS were not provisioned and the component swallowed the resulting errors.
-- This migration is idempotent and safe to run on fresh OR existing installs.
-- =============================================================================

-- 1. Table (fresh installs) ----------------------------------------------------
create table if not exists public.inventory (
  id             uuid primary key default gen_random_uuid(),
  gym_owner_id   uuid not null references auth.users (id) on delete cascade,
  item_name      text not null,
  brand          text,
  category       text not null default 'Supplements',
  price          numeric not null default 0 check (price >= 0),
  stock_quantity integer not null default 0 check (stock_quantity >= 0),
  description    text,
  image_url      text,
  show_in_app    boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- 2. Existing installs: make sure every column the app writes exists ----------
alter table public.inventory add column if not exists gym_owner_id   uuid;
alter table public.inventory add column if not exists item_name      text;
alter table public.inventory add column if not exists brand          text;
alter table public.inventory add column if not exists category       text default 'Supplements';
alter table public.inventory add column if not exists price          numeric default 0;
alter table public.inventory add column if not exists stock_quantity integer default 0;
alter table public.inventory add column if not exists description    text;
alter table public.inventory add column if not exists image_url      text;
alter table public.inventory add column if not exists show_in_app    boolean default true;
alter table public.inventory add column if not exists created_at     timestamptz default now();
alter table public.inventory add column if not exists updated_at     timestamptz default now();

create index if not exists inventory_gym_owner_id_idx on public.inventory (gym_owner_id);

-- 3. Row Level Security: an owner can fully manage ONLY their own products -----
alter table public.inventory enable row level security;

drop policy if exists "Owners read their own inventory"   on public.inventory;
drop policy if exists "Owners insert their own inventory"  on public.inventory;
drop policy if exists "Owners update their own inventory"  on public.inventory;
drop policy if exists "Owners delete their own inventory"  on public.inventory;

create policy "Owners read their own inventory"
  on public.inventory for select to authenticated
  using ( auth.uid() = gym_owner_id );

create policy "Owners insert their own inventory"
  on public.inventory for insert to authenticated
  with check ( auth.uid() = gym_owner_id );

create policy "Owners update their own inventory"
  on public.inventory for update to authenticated
  using ( auth.uid() = gym_owner_id )
  with check ( auth.uid() = gym_owner_id );

create policy "Owners delete their own inventory"
  on public.inventory for delete to authenticated
  using ( auth.uid() = gym_owner_id );

-- NOTE: the member-facing "read show_in_app products of my gym" SELECT policy
-- is added in Step 3 (Member Storefront), once we wire the member→gym join.

-- 4. Storage bucket for product images ----------------------------------------
insert into storage.buckets (id, name, public)
values ('inventory-items', 'inventory-items', true)
on conflict (id) do update set public = true;

-- Public read; authenticated owners may write only inside their own uid folder
-- (the app uploads to `${auth.uid()}/<file>`).
drop policy if exists "Public read inventory images"        on storage.objects;
drop policy if exists "Owners upload their inventory images" on storage.objects;
drop policy if exists "Owners update their inventory images" on storage.objects;
drop policy if exists "Owners delete their inventory images" on storage.objects;

create policy "Public read inventory images"
  on storage.objects for select
  using ( bucket_id = 'inventory-items' );

create policy "Owners upload their inventory images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'inventory-items'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners update their inventory images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'inventory-items'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners delete their inventory images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'inventory-items'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 5. Realtime: stream inserts/updates/deletes to the owner's live grid --------
do $$
begin
  alter publication supabase_realtime add table public.inventory;
exception
  when duplicate_object then null; -- already in the publication
end $$;
