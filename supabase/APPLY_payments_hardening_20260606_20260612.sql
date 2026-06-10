-- =============================================================================
-- APPLY: payments / store / membership hardening — migrations 20260606–20260612.
-- -----------------------------------------------------------------------------
-- A single, ordered, idempotent bundle of the seven hardening migrations. Paste
-- into the Supabase SQL editor and Run to bring the live DB to the correct state
-- (or to confirm it's already there — every block is "safe to re-run", so no
-- error = applied). Each migration keeps its own begin;…commit; so they apply as
-- independent transactions.
--
-- This is a GENERATED concatenation of supabase/migrations/20260606…20260612 in
-- ascending order — do not hand-edit; regenerate from the source migrations.
-- After running, the trailing `notify pgrst, 'reload schema';` makes PostgREST
-- pick up the new RPCs immediately (otherwise the app sees HTTP 404 / PGRST202
-- on a fresh function until its cache reloads).
--
-- To VERIFY instead of apply, run supabase/VERIFY_payments_hardening_20260606_20260612.sql.
-- =============================================================================

-- #############################################################################
-- ##  20260606_payments_rls.sql
-- #############################################################################
-- =============================================================================
-- (a) PAYMENTS â€” schema reconcile + Row-Level Security lockdown.
-- -----------------------------------------------------------------------------
-- Live facts (verified in Supabase, 2026-06-06):
--   â€¢ payments columns are: id, member_id, amount, payment_method, status,
--     created_at, gym_owner_id  â€” it is MISSING gym_id, plan_name, payment_date
--     that the app (MemberUpiCheckout/MembersList) inserts and approve_payment
--     reads. So step 1 reconciles that drift.
--   â€¢ payments is EMPTY (no back-fill needed).
--   â€¢ payments already had RLS enabled + pre-existing policies; step 4 REPLACES
--     them with a vetted set so an unknown permissive policy can't undercut the
--     lockdown. (If any old policy is load-bearing, fold it in before running.)
--
-- After this: a member may only read their own payments and only INSERT a
-- 'pending_verification' row for themselves â€” never 'Success'/'Paid'. Owners get
-- full access to their gym's payments. approve_payment/reject_payment are
-- SECURITY DEFINER and bypass RLS, so approval is unaffected.
--
-- Idempotent; safe to re-run. Apply BEFORE 20260607_membership_column_lockdown
-- (that migration's approve_payment references the columns added here).
-- =============================================================================

begin;

-- 1. Reconcile schema drift â€” add the columns the app/RPC already use. ---------
alter table public.payments add column if not exists gym_id       uuid;
alter table public.payments add column if not exists plan_name    text;
alter table public.payments add column if not exists payment_date timestamptz default now();

-- 2. Auto-fill gym_owner_id / gym_id on INSERT when the client omits them. -----
--    The owner "record payment" path (MembersList.tsx) sends neither; we derive
--    them from the `members` view (profiles â‹ˆ gym_settings). BEFORE INSERT fires
--    before the RLS WITH CHECK, so the filled gym_owner_id is what the owner
--    policy sees. If the member isn't found we leave the row as-is (RLS decides).
create or replace function public.app_fill_payment_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid;
  v_gym   uuid;
begin
  if new.gym_owner_id is null or new.gym_id is null then
    select m.gym_owner_id, m.gym_id
      into v_owner, v_gym
    from public.members m
    where m.id = new.member_id;

    if found then
      new.gym_owner_id := coalesce(new.gym_owner_id, v_owner);
      new.gym_id       := coalesce(new.gym_id, v_gym);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_fill_payment_owner on public.payments;
create trigger trg_fill_payment_owner
  before insert on public.payments
  for each row execute function public.app_fill_payment_owner();

-- 3. Ensure RLS is on (it already is; harmless if re-run). ---------------------
alter table public.payments enable row level security;

-- 4. Replace ALL existing payments policies with a vetted set. -----------------
--    Drops whatever is currently there (the pre-existing ~6) so the lockdown is
--    deterministic and can't be undercut by an unknown permissive policy.
do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'payments'
  loop
    execute format('drop policy if exists %I on public.payments', pol.policyname);
  end loop;
end $$;

-- Member: read only your own payments.
create policy payments_member_select on public.payments
  for select to authenticated
  using (member_id = auth.uid());

-- Member: insert ONLY a pending UPI payment for yourself. This is the line that
-- kills the self-activation bug: status is pinned to 'pending_verification' and
-- member_id to self, so a member can never write 'Success'/'Paid'.
create policy payments_member_insert on public.payments
  for insert to authenticated
  with check (
    member_id = auth.uid()
    and status = 'pending_verification'
  );

-- Owner: full access to payments for gyms you own.
create policy payments_owner_all on public.payments
  for all to authenticated
  using (gym_owner_id = auth.uid())
  with check (gym_owner_id = auth.uid());

commit;


-- #############################################################################
-- ##  20260607_membership_column_lockdown.sql
-- #############################################################################
-- =============================================================================
-- (b) MEMBERSHIP COLUMN LOCKDOWN â€” stop members granting themselves a plan.
-- -----------------------------------------------------------------------------
-- `members` is a VIEW over `profiles` (joined to gym_settings only to surface
-- gym_owner_id), so the base table â€” and the only place a BEFORE trigger can
-- live â€” is `profiles`. profiles holds status, membership_plan,
-- subscription_status, subscription_end_date AND expiry_date.
--
-- The hole: MemberActivePlans.tsx writes profiles directly from the member's own
-- session (status='Active', subscription_end_date, membership_plan, â€¦). profiles
-- has NO RLS (and broad grants), so without this a member can self-activate.
--
-- The trigger allows a change to the protected columns ONLY when the gym's OWNER
-- makes it (verified against gym_settings) or when the authorized activation RPC
-- sets a transaction-local flag. This permits every legitimate writer:
--   â€¢ Owner auto-expiry (dashboard.tsx) + activate (MembersList.tsx) â€” owner of
--     the row's gym, so allowed. Also covers the cross-member case the naive
--     "is it your own row" check would have missed.
--   â€¢ app_activate_member (below) â€” sets the flag.
--   â€¢ Member self-edits of name/phone/avatar â€” not protected columns, untouched.
--   â€¢ Owner SaaS billing â€” writes gym_settings, not profiles.
--
-- The `app.` flag is set only inside our SECURITY DEFINER functions; PostgREST
-- clients can't issue a bare SET before an UPDATE, so it can't be spoofed.
--
-- Idempotent; safe to re-run. Apply AFTER 20260606_payments_rls (payments needs
-- its gym_id/plan_name columns before approve_payment references them).
-- =============================================================================

begin;

-- 1. The single authorized writer of membership columns. ----------------------
--    Writes the base table `profiles` (the `members` view isn't updatable â€” it
--    has a join). Sets both subscription_end_date and expiry_date since the view
--    surfaces COALESCE(subscription_end_date, expiry_date). NOT granted to members.
create or replace function public.app_activate_member(
  p_member uuid,
  p_plan   text,
  p_expiry timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform set_config('app.allow_membership_write', 'on', true);

  update public.profiles
     set status                = 'Active',
         subscription_status   = 'Active',
         membership_plan       = coalesce(p_plan, membership_plan),
         subscription_end_date = p_expiry,
         expiry_date           = p_expiry
   where id = p_member;
end;
$$;

revoke all on function public.app_activate_member(uuid, text, timestamptz) from public;
revoke all on function public.app_activate_member(uuid, text, timestamptz) from anon, authenticated;

-- 2. The lockdown trigger function (on profiles). -----------------------------
--    Compares OLD/NEW as jsonb so it only checks protected keys that exist.
--    A protected-column change is allowed iff the flag is set OR the caller owns
--    the gym the row belongs to (gym_settings.id = profiles.gym_id).
create or replace function public.app_lock_membership_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  protected text[] := array[
    'status', 'membership_plan',
    'subscription_status', 'subscription_end_date', 'expiry_date'
  ];
  col        text;
  newj       jsonb := to_jsonb(new);
  oldj       jsonb := to_jsonb(old);
  v_changed  boolean := false;
begin
  -- Authorized server path (app_activate_member / future verified webhook).
  if coalesce(current_setting('app.allow_membership_write', true), '') = 'on' then
    return new;
  end if;

  -- Did any protected column actually change? If not, it's a plain profile edit.
  foreach col in array protected loop
    if (newj ? col) and ((newj->>col) is distinct from (oldj->>col)) then
      v_changed := true;
      exit;
    end if;
  end loop;
  if not v_changed then
    return new;
  end if;

  -- A protected change is only allowed by the OWNER of the row's gym.
  if auth.uid() is not null and exists (
    select 1
    from public.gym_settings gs
    where gs.id = new.gym_id
      and gs.gym_owner_id = auth.uid()
  ) then
    return new;
  end if;

  raise exception
    'Membership status/plan/expiry can only be changed by the gym owner (after a verified payment).'
    using errcode = 'check_violation';
end;
$$;

-- 3. Attach to profiles only (members is a view; INSERTs at signup are fine). --
drop trigger if exists trg_lock_membership_cols on public.profiles;
create trigger trg_lock_membership_cols
  before update on public.profiles
  for each row execute function public.app_lock_membership_columns();

-- 4. Route owner approval through the chokepoint. -----------------------------
--    Same shape as 20260605_payment_verification, but activation now goes via
--    app_activate_member (sets the flag, writes profiles) and the gym used for
--    plan-duration lookup comes from payments.gym_id (added in 20260606).
create or replace function public.approve_payment(p_payment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner       uuid := auth.uid();
  v_member      uuid;
  v_gym         uuid;
  v_plan        text;
  v_amount      numeric;
  v_status      text;
  v_member_name text;
  v_duration    integer;
  v_expiry      timestamptz;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  select member_id, gym_id, plan_name, amount, status
    into v_member, v_gym, v_plan, v_amount, v_status
  from public.payments
  where id = p_payment_id and gym_owner_id = v_owner
  for update;

  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found or not yours.');
  end if;
  if v_status = 'Success' then
    return jsonb_build_object('success', true, 'already', true);
  end if;

  select coalesce(gp.duration_days, gp.duration * 30, 30)
    into v_duration
  from public.gym_plans gp
  where gp.gym_id = v_gym and (gp.name = v_plan or gp.plan_name = v_plan)
  order by gp.created_at desc
  limit 1;
  if v_duration is null then v_duration := 30; end if;
  v_expiry := now() + make_interval(days => v_duration);

  update public.payments set status = 'Success' where id = p_payment_id;

  -- Activate via the single authorized writer (sets the lockdown flag).
  perform public.app_activate_member(v_member, v_plan, v_expiry);

  select coalesce(m.full_name, m.member_name, 'A member')
    into v_member_name from public.members m where m.id = v_member;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (
    v_owner, 'payment',
    coalesce(v_member_name, 'A member') || ' payment of â‚¹' || v_amount::text || ' approved (' || coalesce(v_plan, 'plan') || ').',
    false
  );

  return jsonb_build_object('success', true, 'expiry_date', v_expiry, 'plan', v_plan);
end;
$$;

revoke all on function public.approve_payment(uuid) from public;
grant execute on function public.approve_payment(uuid) to authenticated;

commit;


-- #############################################################################
-- ##  20260608_store_upi_payments.sql
-- #############################################################################
-- =============================================================================
-- Store purchases via UPI (manual owner verification).
-- -----------------------------------------------------------------------------
-- Replaces the INSTANT store purchase with a paid flow that mirrors membership
-- fees: the member taps Buy â†’ we RESERVE stock and create a pending purchase
-- (server-computed price, so the discount can't be spoofed) â†’ the member pays
-- the gym's UPI QR â†’ the owner approves (sale completes) or rejects (stock is
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

-- 3. INITIATE â€” reserve stock + create a pending purchase, server-priced. ------
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

-- 4. APPROVE â€” finalize the sale (stock already reserved at initiate). ---------
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

-- 5. REJECT â€” restore the reserved stock and mark rejected. --------------------
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

-- 6. Grants â€” members initiate; owners approve/reject. -------------------------
revoke all on function public.initiate_store_purchase(uuid, integer) from public;
revoke all on function public.approve_store_purchase(uuid)            from public;
revoke all on function public.reject_store_purchase(uuid)             from public;
grant execute on function public.initiate_store_purchase(uuid, integer) to authenticated;
grant execute on function public.approve_store_purchase(uuid)            to authenticated;
grant execute on function public.reject_store_purchase(uuid)             to authenticated;

commit;


-- #############################################################################
-- ##  20260609_cancel_store_purchase.sql
-- #############################################################################
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


-- #############################################################################
-- ##  20260610_expire_stale_store_purchases.sql
-- #############################################################################
-- =============================================================================
-- Auto-expire stale pending store purchases (fetch-time sweep).
-- -----------------------------------------------------------------------------
-- A member who taps Buy and walks away holds the reserved stock indefinitely.
-- This RPC expires any purchase still 'pending_verification' after N minutes
-- (default 30): it marks them 'expired' and returns the reserved units to stock.
-- Called cheaply when a store / owner-approvals view loads â€” no cron needed.
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


-- #############################################################################
-- ##  20260611_expire_overdue_members.sql
-- #############################################################################
-- =============================================================================
-- Auto-expire overdue members (owner-triggered, fetch-time sweep).
-- -----------------------------------------------------------------------------
-- The dashboard used to mark expired members 'Inactive' with a client-side
-- `update public.members ...`, but `members` is a non-updatable JOIN view AND an
-- owner cannot update another user's `profiles` row under RLS. So the write
-- silently no-op'd and expired members stayed 'Active'.
--
-- This SECURITY DEFINER RPC does it correctly: it flips the CALLING owner's own
-- members (scoped via gym_settings.gym_owner_id = auth.uid()) from active â†’
-- Inactive once their expiry_date has passed, writing to the base `profiles`
-- table. Returns a count. Idempotent; safe to call cheaply on every dashboard
-- load (mirrors expire_stale_store_purchases).
-- =============================================================================

begin;

create or replace function public.expire_overdue_members()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_count integer;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'error', 'Not signed in.');
  end if;

  with expired as (
    update public.profiles p
      set status = 'Inactive'
    from public.gym_settings gs
    where gs.id = p.gym_id
      and gs.gym_owner_id = v_owner
      and lower(coalesce(p.status, '')) = 'active'
      and p.expiry_date is not null
      and p.expiry_date < now()
    returning 1
  )
  select count(*) into v_count from expired;

  return jsonb_build_object('success', true, 'expired_count', coalesce(v_count, 0));
end;
$$;

revoke all on function public.expire_overdue_members() from public;
grant execute on function public.expire_overdue_members() to authenticated;

commit;


-- #############################################################################
-- ##  20260612_sync_member_amount_paid.sql
-- #############################################################################
-- =============================================================================
-- Reconcile profiles.amount_paid with the approved-payments ledger.
-- -----------------------------------------------------------------------------
-- The denormalized profiles.amount_paid column is read by the "Amount Paid"
-- column (MembersList), Pending Dues (dashboard.tsx) and parts of Revenue. It
-- was bumped ad-hoc by the owner "Collect Payment" / "Mark Paid" flows and held
-- stale test data (e.g. â‚¹101,000) that never matched the payments table.
--
-- The payments ledger is the single source of truth for realized revenue, and
-- ONLY approved rows (status Paid/Success) count â€” pending_verification /
-- rejected never do (mirrors src/lib/revenue.ts isApprovedPayment).
--
-- This migration:
--   1. installs a function that recomputes one member's amount_paid from their
--      approved payments,
--   2. installs an AFTER trigger on payments so any insert/update/delete (incl.
--      approve_payment flipping a UPI row to 'Success') keeps amount_paid in
--      sync â€” the column can never drift from the ledger again, and
--   3. back-fills every existing member once, clearing stale test data.
--
-- amount_paid is NOT one of the protected columns in 20260607's membership
-- lockdown trigger, so these owner-less, definer-context updates pass cleanly.
--
-- Idempotent; safe to re-run. Apply AFTER 20260606_payments_rls (needs the
-- ledger's final shape) and 20260607_membership_column_lockdown.
-- =============================================================================

begin;

-- 0. Guarantee the column exists before anything references it. -----------------
--    The app reads profiles.amount_paid, but this repo has a history of live
--    schema drift (e.g. profiles was missing subscription_status). Without this
--    guard a missing column would abort the whole transaction. numeric + default
--    0 so the back-fill and trigger always have a valid target.
alter table public.profiles
  add column if not exists amount_paid numeric not null default 0;

-- 1. Recompute a single member's amount_paid from approved payments. -----------
create or replace function public.app_sync_member_amount_paid(p_member uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_member is null then
    return;
  end if;

  update public.profiles p
     set amount_paid = coalesce((
       select sum(pay.amount)
       from public.payments pay
       where pay.member_id = p_member
         and lower(trim(coalesce(pay.status, ''))) in ('paid', 'success')
     ), 0)
   where p.id = p_member;
end;
$$;

-- 2. Resync the affected member(s) after any payments change. -------------------
create or replace function public.app_payments_resync_amount_paid()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    perform public.app_sync_member_amount_paid(old.member_id);
    return null;
  end if;

  -- INSERT or UPDATE
  perform public.app_sync_member_amount_paid(new.member_id);

  -- A payment re-pointed to a different member: resync the old one too.
  if tg_op = 'UPDATE' and old.member_id is distinct from new.member_id then
    perform public.app_sync_member_amount_paid(old.member_id);
  end if;

  return null;
end;
$$;

drop trigger if exists trg_payments_resync_amount_paid on public.payments;
create trigger trg_payments_resync_amount_paid
  after insert or update or delete on public.payments
  for each row execute function public.app_payments_resync_amount_paid();

-- 3. One-time back-fill for every existing member (clears stale test data). -----
update public.profiles p
   set amount_paid = coalesce((
     select sum(pay.amount)
     from public.payments pay
     where pay.member_id = p.id
       and lower(trim(coalesce(pay.status, ''))) in ('paid', 'success')
   ), 0);

commit;


-- --- Reload PostgREST schema cache so new RPCs are callable immediately. ------
notify pgrst, 'reload schema';

