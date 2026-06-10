-- =============================================================================
-- Member-cancel for a pending store purchase.
-- -----------------------------------------------------------------------------
-- Companion to 20260608_store_upi_payments: lets a MEMBER abandon their own
-- pending purchase (e.g. they closed the UPI dialog without paying) and get the
-- reserved stock put back. Owner-side reject already exists; this is the member
-- equivalent, authorized by member_id = auth.uid(). Marks 'cancelled' (distinct
-- from owner 'rejected') so the two are distinguishable in history.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

create or replace function public.cancel_store_purchase(p_purchase_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member  uuid := auth.uid();
  v_product uuid;
  v_qty     integer;
  v_status  text;
begin
  if v_member is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  -- Only your OWN pending purchase can be cancelled.
  select product_id, quantity, status
    into v_product, v_qty, v_status
  from public.purchases
  where id = p_purchase_id and member_id = v_member
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Purchase not found.');
  end if;
  if v_status <> 'pending_verification' then
    return jsonb_build_object('success', false, 'error', 'This purchase can no longer be cancelled.');
  end if;

  update public.purchases set status = 'cancelled' where id = p_purchase_id;

  -- Return the reserved units (product may have been deleted -> skip).
  if v_product is not null then
    update public.inventory
      set stock_quantity = stock_quantity + v_qty,
          updated_at = now()
    where id = v_product;
  end if;

  return jsonb_build_object('success', true);
end;
$$;

revoke all on function public.cancel_store_purchase(uuid) from public;
grant execute on function public.cancel_store_purchase(uuid) to authenticated;

commit;
