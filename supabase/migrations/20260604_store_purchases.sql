-- =============================================================================
-- Store Purchases — members buy products from the gym store; owners see sales.
-- -----------------------------------------------------------------------------
-- A `purchases` table records every store sale, plus a secure RPC that performs
-- the buy atomically:
--   • SECURITY DEFINER so a member can decrement inventory stock (they have no
--     UPDATE policy on inventory) WITHOUT loosening RLS. Re-authorized inside.
--   • The discount is RE-COMPUTED server-side (active campaign + 30-day streak
--     from check_ins) so a member can't spoof a cheaper price from the client.
--   • Stock is checked + decremented under a row lock to avoid oversell races.
--   • Logs to activity_log so the owner dashboard's realtime feed lights up.
--
-- Idempotent; safe to run multiple times.
-- =============================================================================

-- 1. Table ---------------------------------------------------------------------
create table if not exists public.purchases (
  id                  uuid primary key default gen_random_uuid(),
  member_id           uuid not null,
  product_id          uuid references public.inventory (id) on delete set null,
  gym_id              uuid,
  gym_owner_id        uuid,
  item_name           text,
  category            text,
  image_url           text,
  quantity            integer not null default 1 check (quantity > 0),
  original_price      numeric not null default 0,   -- list price snapshot
  unit_price          numeric not null default 0,   -- price actually paid, per unit
  discount_percentage numeric not null default 0,
  campaign_id         uuid,
  total_amount        numeric not null default 0,
  created_at          timestamptz not null default now()
);

create index if not exists purchases_member_idx on public.purchases (member_id);
create index if not exists purchases_owner_idx on public.purchases (gym_owner_id);

-- 2. RLS — members read their own, owners read their gym's. Writes go through
--    the RPC (security definer), so no direct INSERT policy is granted. --------
alter table public.purchases enable row level security;

drop policy if exists "Members read their own purchases" on public.purchases;
drop policy if exists "Owners read their gym purchases"  on public.purchases;

create policy "Members read their own purchases"
  on public.purchases for select to authenticated
  using ( auth.uid() = member_id );

create policy "Owners read their gym purchases"
  on public.purchases for select to authenticated
  using ( auth.uid() = gym_owner_id );

-- 3. Secure purchase RPC -------------------------------------------------------
create or replace function public.process_store_purchase(
  p_product_id uuid,
  p_quantity   integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id   uuid := auth.uid();
  v_member_name text;
  v_price       numeric;
  v_category    text;
  v_item_name   text;
  v_image_url   text;
  v_gym_id      uuid;
  v_gym_owner   uuid;
  v_stock       integer;
  v_visible     boolean;
  v_streak      integer := 0;
  v_cursor      date := current_date;
  v_has         boolean;
  v_discount    numeric := 0;
  v_campaign_id uuid;
  v_unit_price  numeric;
  v_total       numeric;
  v_purchase_id uuid;
begin
  -- 1. AUTHORIZATION — must be a signed-in member buying for themselves.
  if v_member_id is null then
    return jsonb_build_object('success', false, 'error', 'You must be signed in to buy.');
  end if;
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be at least 1.');
  end if;

  -- 2. Lock the product row and read its current state.
  select i.price, i.category, i.item_name, i.image_url, i.gym_id, i.gym_owner_id,
         i.stock_quantity, i.show_in_app
    into v_price, v_category, v_item_name, v_image_url, v_gym_id, v_gym_owner,
         v_stock, v_visible
  from public.inventory i
  where i.id = p_product_id
  for update;

  if not found or v_visible is not true then
    return jsonb_build_object('success', false, 'error', 'This product is not available.');
  end if;

  -- 3. Stock check.
  if v_stock < p_quantity then
    return jsonb_build_object(
      'success', false,
      'error', 'Not enough stock.',
      'available', v_stock
    );
  end if;

  -- 4. Member's consecutive-day streak (ending today, or yesterday as grace).
  select exists(
    select 1 from public.check_ins
    where member_id = v_member_id and (check_in_time)::date = current_date
  ) into v_has;
  if not v_has then
    v_cursor := current_date - 1;
  end if;
  loop
    select exists(
      select 1 from public.check_ins
      where member_id = v_member_id and (check_in_time)::date = v_cursor
    ) into v_has;
    exit when not v_has;
    v_streak := v_streak + 1;
    v_cursor := v_cursor - 1;
  end loop;

  -- 5. Best applicable active campaign (server-authoritative discount).
  select c.id, c.discount_percentage
    into v_campaign_id, v_discount
  from public.campaigns c
  where c.gym_owner_id = v_gym_owner
    and c.is_active = true
    and (c.ends_at is null or c.ends_at > now())  -- skip expired campaigns
    and (c.applies_to = 'All' or c.applies_to = v_category)
    and (
      c.target_type = 'global'
      or (c.target_type = 'streak' and v_streak >= 30)
    )
  order by c.discount_percentage desc
  limit 1;

  if not found then
    v_discount := 0;
    v_campaign_id := null;
  end if;

  v_unit_price := round(v_price * (1 - v_discount / 100));
  v_total := v_unit_price * p_quantity;

  -- 6. Record the sale.
  insert into public.purchases (
    member_id, product_id, gym_id, gym_owner_id, item_name, category, image_url,
    quantity, original_price, unit_price, discount_percentage, campaign_id, total_amount
  ) values (
    v_member_id, p_product_id, v_gym_id, v_gym_owner, v_item_name, v_category, v_image_url,
    p_quantity, v_price, v_unit_price, v_discount, v_campaign_id, v_total
  )
  returning id into v_purchase_id;

  -- 7. Decrement stock (RLS bypassed by SECURITY DEFINER; step 1 authorized).
  update public.inventory
    set stock_quantity = stock_quantity - p_quantity,
        updated_at = now()
  where id = p_product_id;

  -- 8. Owner activity feed — instant via existing realtime on activity_log.
  select coalesce(m.full_name, m.member_name, 'A member')
    into v_member_name
  from public.members m
  where m.id = v_member_id;

  if v_gym_owner is not null then
    insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
    values (
      v_gym_owner, 'purchase',
      coalesce(v_member_name, 'A member') || ' bought ' || p_quantity || 'x ' || v_item_name
        || ' for ₹' || v_total::text, false
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'purchase_id', v_purchase_id,
    'item_name', v_item_name,
    'quantity', p_quantity,
    'unit_price', v_unit_price,
    'discount_percentage', v_discount,
    'total_amount', v_total
  );
end;
$$;

revoke all on function public.process_store_purchase(uuid, integer) from public;
grant execute on function public.process_store_purchase(uuid, integer) to authenticated;

-- 9. Realtime for owner/member purchase feeds ---------------------------------
do $$
begin
  alter publication supabase_realtime add table public.purchases;
exception
  when duplicate_object then null;
end $$;
