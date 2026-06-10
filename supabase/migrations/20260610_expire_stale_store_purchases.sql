-- =============================================================================
-- Auto-expire stale pending store purchases (fetch-time sweep).
-- -----------------------------------------------------------------------------
-- A member who taps Buy and walks away holds the reserved stock indefinitely.
-- This RPC expires any purchase still 'pending_verification' after N minutes
-- (default 30): it marks them 'expired' and returns the reserved units to stock.
-- Called cheaply when a store / owner-approvals view loads — no cron needed.
--
-- Concurrency-safe: the CTE UPDATE flips each row exactly once (a row already
-- expired by a concurrent caller no longer matches status='pending_verification'),
-- so stock is restored exactly once per purchase.
--
-- SECURITY DEFINER + granted to authenticated: it's an idempotent maintenance
-- sweep that only touches genuinely-stale holds and returns just a count.
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

create or replace function public.expire_stale_store_purchases(p_minutes integer default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_minutes is null or p_minutes < 1 then
    p_minutes := 30;
  end if;

  with expired as (
    update public.purchases
      set status = 'expired'
    where status = 'pending_verification'
      and created_at < now() - make_interval(mins => p_minutes)
    returning product_id, quantity
  ),
  restock as (
    select product_id, sum(quantity) as qty
    from expired
    where product_id is not null
    group by product_id
  ),
  applied as (
    update public.inventory i
      set stock_quantity = i.stock_quantity + r.qty,
          updated_at = now()
    from restock r
    where i.id = r.product_id
    returning 1
  )
  select count(*) into v_count from expired;

  return jsonb_build_object('success', true, 'expired_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.expire_stale_store_purchases(integer) from public;
grant execute on function public.expire_stale_store_purchases(integer) to authenticated;

commit;
