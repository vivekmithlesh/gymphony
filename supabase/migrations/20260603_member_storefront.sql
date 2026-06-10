-- =============================================================================
-- Member Storefront — Step 3 of the Inventory & Campaigns system.
-- Lets members READ their gym's visible products and active campaigns (the
-- owner-only policies from Steps 1 & 2 are kept; these are additive, permissive
-- SELECT policies). Also backfills inventory.gym_id so the member query, which
-- filters by gym_id, finds existing products.
--
-- Idempotent; safe on fresh OR existing installs.
-- =============================================================================

-- 0. Ensure inventory.gym_id exists and is indexed (member lookups use it) -----
alter table public.inventory add column if not exists gym_id uuid;
create index if not exists inventory_gym_id_idx on public.inventory (gym_id);

-- Backfill gym_id from gym_settings for any product that only has gym_owner_id.
update public.inventory inv
set gym_id = gs.id
from public.gym_settings gs
where inv.gym_owner_id = gs.gym_owner_id
  and inv.gym_id is null;

-- 1. Members can read their gym's IN-APP products -----------------------------
drop policy if exists "Members read their gym's visible inventory" on public.inventory;

create policy "Members read their gym's visible inventory"
  on public.inventory for select to authenticated
  using (
    show_in_app = true
    and (
      gym_id in (select gym_id from public.profiles where id = auth.uid())
      or gym_id in (select gym_id from public.members where id = auth.uid())
    )
  );

-- 2. Members can read their gym's ACTIVE campaigns ----------------------------
-- Campaigns are owned by gym_owner_id; map the member's gym_id → owner via
-- gym_settings so a member only ever sees their own gym's offers.
drop policy if exists "Members read their gym's active campaigns" on public.campaigns;

create policy "Members read their gym's active campaigns"
  on public.campaigns for select to authenticated
  using (
    is_active = true
    and (ends_at is null or ends_at > now())  -- auto-expire: hide ended campaigns
    and gym_owner_id in (
      select gs.gym_owner_id
      from public.gym_settings gs
      where gs.id in (
        select gym_id from public.profiles where id = auth.uid()
        union
        select gym_id from public.members where id = auth.uid()
      )
    )
  );
