-- =============================================================================
-- Store purchases via UPI (manual owner verification).
-- -----------------------------------------------------------------------------
-- Replaces the INSTANT store purchase with a paid flow that mirrors membership
-- fees: the member taps Buy → we RESERVE stock and create a pending purchase
-- (server-computed price, so the discount can't be spoofed) → the member pays
-- the gym's UPI QR → the owner approves (sale completes) or rejects (stock is
-- restored). The old instant `process_store_purchase` is DROPPED so a member
-- can't call it directly to acquire stock without paying.
--
-- Stock is reserved at Buy time (not at approval) so a member is never told
-- "out of stock" AFTER paying; a reject puts the units back.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- 1. purchases lifecycle columns. Existing rows are historical completed sales.
alter table public.purchases add column if not exists status         text not null default 'completed';
alter table public.purchases add column if not exists payment_method text;
alter table public.purchases add column if not exists payment_date   timestamptz;

create index if not exists purchases_pending_idx
  on public.purchases (gym_owner_id, status);

-- 2. Remove the instant-purchase backdoor (it decremented stock with no payment).
drop function if exists public.process_store_purchase(uuid, integer);

-- 3. INITIATE — reserve stock + create a pending purchase, server-priced. ------
create or replace function public.initiate_store_purchase(
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
  if v_member_id is null then
    return jsonb_build_object('success', false, 'error', 'You must be signed in to buy.');
  end if;
  if p_quantity is null or p_quantity < 1 then
    return jsonb_build_object('success', false, 'error', 'Quantity must be at least 1.');
  end if;

  -- Lock the product and read current state.
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
  if v_stock < p_quantity then
    return jsonb_build_object('success', false, 'error', 'Not enough stock.', 'available', v_stock);
  end if;

  -- Consecutive-day streak (ending today, or yesterday as grace).
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

  -- Best applicable active campaign (server-authoritative discount).
  select c.id, c.discount_percentage
    into v_campaign_id, v_discount
  from public.campaigns c
  where c.gym_owner_id = v_gym_owner
    and c.is_active = true
    and (c.ends_at is null or c.ends_at > now())
    and (c.applies_to = 'All' or c.applies_to = v_category)
    and (c.target_type = 'global' or (c.target_type = 'streak' and v_streak >= 30))
  order by c.discount_percentage desc
  limit 1;

  if not found then
    v_discount := 0;
    v_campaign_id := null;
  end if;

  v_unit_price := round(v_price * (1 - v_discount / 100));
  v_total := v_unit_price * p_quantity;

  -- Reserve the stock now so it can't be oversold while payment is pending.
  update public.inventory
    set stock_quantity = stock_quantity - p_quantity,
        updated_at = now()
  where id = p_product_id;

  -- Record the pending sale.
  insert into public.purchases (
    member_id, product_id, gym_id, gym_owner_id, item_name, category, image_url,
    quantity, original_price, unit_price, discount_percentage, campaign_id, total_amount,
    status, payment_method, payment_date
  ) values (
    v_member_id, p_product_id, v_gym_id, v_gym_owner, v_item_name, v_category, v_image_url,
    p_quantity, v_price, v_unit_price, v_discount, v_campaign_id, v_total,
    'pending_verification', 'UPI', now()
  )
  returning id into v_purchase_id;

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

-- 4. APPROVE — finalize the sale (stock already reserved at initiate). ---------
create or replace function public.approve_store_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner       uuid := auth.uid();
  v_member      uuid;
  v_member_name text;
  v_item        text;
  v_qty         integer;
  v_total       numeric;
  v_status      text;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  select member_id, item_name, quantity, total_amount, status
    into v_member, v_item, v_qty, v_total, v_status
  from public.purchases
  where id = p_purchase_id and gym_owner_id = v_owner
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Purchase not found or not yours.');
  end if;
  if v_status = 'completed' then
    return jsonb_build_object('success', true, 'already', true);
  end if;
  if v_status <> 'pending_verification' then
    return jsonb_build_object('success', false, 'error', 'This purchase is not pending.');
  end if;

  update public.purchases set status = 'completed' where id = p_purchase_id;

  -- Activity feed: best-effort only. Wrapped so schema drift in activity_log
  -- (e.g. a missing column) can never block a real purchase approval.
  begin
    select coalesce(m.full_name, m.member_name, 'A member')
      into v_member_name from public.members m where m.id = v_member;

    insert into public.activity_log (gym_owner_id, activity_type, description)
    values (
      v_owner, 'purchase',
      coalesce(v_member_name, 'A member') || ' bought ' || v_qty || 'x ' || v_item
        || ' for Rs ' || v_total::text || ' (paid via UPI).'
    );
  exception when others then
    null;
  end;

  return jsonb_build_object('success', true);
end;
$$;

-- 5. REJECT — restore the reserved stock and mark rejected. --------------------
create or replace function public.reject_store_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner    uuid := auth.uid();
  v_product  uuid;
  v_qty      integer;
  v_status   text;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  select product_id, quantity, status
    into v_product, v_qty, v_status
  from public.purchases
  where id = p_purchase_id and gym_owner_id = v_owner
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Purchase not found or not yours.');
  end if;
  if v_status <> 'pending_verification' then
    return jsonb_build_object('success', false, 'error', 'This purchase is not pending.');
  end if;

  update public.purchases set status = 'rejected' where id = p_purchase_id;

  -- Put the reserved units back (product may have been deleted -> skip).
  if v_product is not null then
    update public.inventory
      set stock_quantity = stock_quantity + v_qty,
          updated_at = now()
    where id = v_product;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

-- 6. Grants — members initiate; owners approve/reject. -------------------------
revoke all on function public.initiate_store_purchase(uuid, integer) from public;
revoke all on function public.approve_store_purchase(uuid)            from public;
revoke all on function public.reject_store_purchase(uuid)             from public;
grant execute on function public.initiate_store_purchase(uuid, integer) to authenticated;
grant execute on function public.approve_store_purchase(uuid)            to authenticated;
grant execute on function public.reject_store_purchase(uuid)             to authenticated;

commit;
