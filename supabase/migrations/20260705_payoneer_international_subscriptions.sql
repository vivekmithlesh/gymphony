-- =============================================================================
-- 20260705 — Payoneer international owner subscriptions (manual verification).
-- -----------------------------------------------------------------------------
-- Adds an ISOLATED international payment flow for owners OUTSIDE India, mirroring
-- the manual-UPI rails (20260629/20260630) but in its own table + RPCs so the
-- Indian flow is guaranteed untouched. Purchasing-power-adjusted USD pricing is
-- computed SERVER-SIDE (the client never sends an amount). A platform admin
-- approves a submitted payment; approval is the ONLY path that activates the
-- plan, via the GUC-flagged gym_settings write permitted by the plan-column
-- lockdown trigger (20260621). Full audit + owner notification throughout.
--
-- Two-phase, like Payoneer demands: (1) create a 'pending' record + reference ID
-- to show payment instructions, (2) owner submits their Payoneer reference/proof
-- -> 'submitted', (3) admin approve -> 'approved' (+ activate) / reject.
--
-- Idempotent; safe to re-run. Depends on: app_config + is_platform_admin()
-- (20260629), platform_support_* keys (20260630), gym_settings plan columns +
-- lockdown (20260621), activity_log (20260624).
-- =============================================================================

begin;

-- 1. international_payments — owner SaaS payment requests (Payoneer). ----------
create table if not exists public.international_payments (
  id                       uuid primary key default gen_random_uuid(),
  owner_id                 uuid not null,
  gym_id                   uuid,
  plan_tier                text not null,
  billing_cycle            text not null default 'monthly',
  country                  text not null,
  country_tier             int  not null,
  currency                 text not null default 'USD',
  amount                   numeric not null,
  gateway                  text not null default 'payoneer',
  payment_reference_id     text not null,          -- system-generated, shown to owner
  user_submitted_reference text,                   -- the owner's Payoneer txn reference
  payment_proof_url        text,
  notes                    text,
  payer_name               text,
  status                   text not null default 'pending'
                             check (status in ('pending','submitted','approved','rejected')),
  reject_reason            text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  approved_at              timestamptz,
  approved_by              uuid,
  created_at               timestamptz not null default now()
);

create unique index if not exists international_payments_ref_unique_idx
  on public.international_payments (payment_reference_id);
-- A Payoneer transaction reference identifies one real transfer — never reuse it.
create unique index if not exists international_payments_user_ref_unique_idx
  on public.international_payments (lower(user_submitted_reference))
  where user_submitted_reference is not null and btrim(user_submitted_reference) <> '';
create index if not exists international_payments_owner_idx  on public.international_payments (owner_id, created_at desc);
create index if not exists international_payments_status_idx on public.international_payments (status, created_at desc);

alter table public.international_payments enable row level security;
-- Owner reads own; admin reads all. ALL writes go through the SECURITY DEFINER
-- RPCs below (no client INSERT/UPDATE policy = clients can't write directly).
drop policy if exists intlpay_select on public.international_payments;
create policy intlpay_select on public.international_payments
  for select to authenticated
  using (owner_id = auth.uid() or public.is_platform_admin());

-- 2. Append-only audit trail (trigger-written; mirrors subscription_audit). ----
create table if not exists public.international_payment_audit (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null,
  owner_id    uuid,
  actor       uuid,
  action      text not null,   -- submitted | approved | rejected | status_changed
  old_status  text,
  new_status  text,
  plan_tier   text,
  amount      numeric,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists intl_audit_payment_idx on public.international_payment_audit (payment_id, created_at desc);
create index if not exists intl_audit_owner_idx   on public.international_payment_audit (owner_id, created_at desc);

alter table public.international_payment_audit enable row level security;
drop policy if exists intlaudit_select on public.international_payment_audit;
create policy intlaudit_select on public.international_payment_audit
  for select to authenticated
  using (owner_id = auth.uid() or public.is_platform_admin());

create or replace function public.fn_international_payment_audit()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_action text;
begin
  begin
    if tg_op = 'INSERT' then
      insert into public.international_payment_audit (payment_id, owner_id, actor, action, old_status, new_status, plan_tier, amount)
      values (new.id, new.owner_id, auth.uid(), 'created', null, new.status, new.plan_tier, new.amount);
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      v_action := case new.status
                    when 'approved'  then 'approved'
                    when 'rejected'  then 'rejected'
                    when 'submitted' then 'submitted'
                    else 'status_changed' end;
      insert into public.international_payment_audit (payment_id, owner_id, actor, action, old_status, new_status, plan_tier, amount, note)
      values (new.id, new.owner_id, auth.uid(), v_action, old.status, new.status, new.plan_tier, new.amount, new.reject_reason);
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists trg_international_payment_audit on public.international_payments;
create trigger trg_international_payment_audit
  after insert or update on public.international_payments
  for each row execute function public.fn_international_payment_audit();

-- 3. Platform Payoneer config (admin-editable; app_config is RLS-locked so access
--    is only ever through these SECURITY DEFINER functions). Support contacts are
--    SHARED with the UPI config (platform_support_*) so they're set once. --------
insert into public.app_config (key, value) values
  ('platform_payoneer_email', ''),
  ('platform_payoneer_account', ''),
  ('platform_payoneer_note', '')
on conflict (key) do nothing;

create or replace function public.get_platform_payoneer()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'email',   coalesce((select value from public.app_config where key = 'platform_payoneer_email'), ''),
    'account', coalesce((select value from public.app_config where key = 'platform_payoneer_account'), ''),
    'note',    coalesce((select value from public.app_config where key = 'platform_payoneer_note'), ''),
    'support_whatsapp', coalesce((select value from public.app_config where key = 'platform_support_whatsapp'), ''),
    'support_email',    coalesce((select value from public.app_config where key = 'platform_support_email'), '')
  );
$$;
grant execute on function public.get_platform_payoneer() to authenticated;

create or replace function public.app_set_platform_payoneer(
  p_email         text,
  p_account       text,
  p_note          text default null,
  p_whatsapp      text default null,
  p_support_email text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;
  insert into public.app_config (key, value) values ('platform_payoneer_email', coalesce(p_email, ''))
    on conflict (key) do update set value = excluded.value;
  insert into public.app_config (key, value) values ('platform_payoneer_account', coalesce(p_account, ''))
    on conflict (key) do update set value = excluded.value;
  insert into public.app_config (key, value) values ('platform_payoneer_note', coalesce(p_note, ''))
    on conflict (key) do update set value = excluded.value;
  insert into public.app_config (key, value) values ('platform_support_whatsapp', coalesce(p_whatsapp, ''))
    on conflict (key) do update set value = excluded.value;
  insert into public.app_config (key, value) values ('platform_support_email', coalesce(p_support_email, ''))
    on conflict (key) do update set value = excluded.value;
end;
$$;
grant execute on function public.app_set_platform_payoneer(text, text, text, text, text) to authenticated;

-- 4. Create RPC (owner) — server computes country tier + amount; client can't
--    tamper. Reuses the owner's latest 'pending' row so reopening the checkout
--    keeps a STABLE reference id (no orphan-row spam). ---------------------------
create or replace function public.app_create_intl_payment(
  p_tier    text,
  p_country text,
  p_cycle   text default 'monthly'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid := auth.uid();
  v_gym     uuid;
  v_tier    text := lower(coalesce(p_tier, ''));
  v_country text := upper(btrim(coalesce(p_country, '')));
  v_cycle   text := case when lower(coalesce(p_cycle, 'monthly')) = 'yearly' then 'yearly' else 'monthly' end;
  v_ctier   int;
  v_monthly integer;
  v_amount  numeric;
  v_ref     text;
  v_id      uuid;
  -- Pro is waitlist-only (mirrors src/lib/plans.ts PRO_IS_WAITLIST). Flip to true
  -- here AND in the UI to sell Pro internationally.
  v_pro_enabled boolean := false;
  v_existing public.international_payments%rowtype;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if v_country = '' or v_country = 'IN' then
    raise exception 'International checkout is for non-India countries; India uses the UPI flow.'
      using errcode = 'check_violation';
  end if;

  if v_tier not in ('starter','growth','pro') then
    raise exception 'invalid plan tier %', p_tier using errcode = 'check_violation';
  end if;
  if v_tier = 'pro' and not v_pro_enabled then
    raise exception 'Pro is not available for purchase yet.' using errcode = 'check_violation';
  end if;

  -- Purchasing-power tier (mirror src/lib/intl-pricing.ts; unlisted -> Tier 1).
  v_ctier := case
    when v_country in ('US','GB','CA','AU','DE','FR','NL','CH','AE','SG') then 1
    when v_country in ('ES','IT','PT','PL','CZ','SA','ZA') then 2
    when v_country in ('PK','BD','NP','LK','PH','ID','VN','EG','NG','KE') then 3
    else 1
  end;

  -- USD per-month price (mirror INTL_PRICES).
  v_monthly := case v_ctier
    when 1 then case v_tier when 'starter' then 29 when 'growth' then 50 when 'pro' then 99 end
    when 2 then case v_tier when 'starter' then 19 when 'growth' then 39 when 'pro' then 79 end
    when 3 then case v_tier when 'starter' then  9 when 'growth' then 19 when 'pro' then 49 end
  end;
  v_amount := case when v_cycle = 'yearly' then v_monthly * 10 else v_monthly end;  -- 2 months free

  select id into v_gym from public.gym_settings where gym_owner_id = v_owner limit 1;

  -- Reuse the latest still-pending request (stable reference across reopens).
  select * into v_existing
    from public.international_payments
   where owner_id = v_owner and status = 'pending'
   order by created_at desc
   limit 1;

  if found then
    update public.international_payments
       set plan_tier = v_tier, billing_cycle = v_cycle, country = v_country,
           country_tier = v_ctier, currency = 'USD', amount = v_amount, gym_id = v_gym
     where id = v_existing.id;
    v_id  := v_existing.id;
    v_ref := v_existing.payment_reference_id;
  else
    v_ref := 'GYM-INTL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
    insert into public.international_payments
      (owner_id, gym_id, plan_tier, billing_cycle, country, country_tier, currency, amount, payment_reference_id, status)
    values
      (v_owner, v_gym, v_tier, v_cycle, v_country, v_ctier, 'USD', v_amount, v_ref, 'pending')
    returning id into v_id;
  end if;

  return jsonb_build_object(
    'id', v_id, 'payment_reference_id', v_ref, 'amount', v_amount, 'currency', 'USD',
    'tier', v_tier, 'country', v_country, 'country_tier', v_ctier, 'cycle', v_cycle
  );
end;
$$;
grant execute on function public.app_create_intl_payment(text, text, text) to authenticated;

-- 5. Submit reference RPC (owner) — attach Payoneer reference/proof -> 'submitted'.
create or replace function public.app_submit_intl_reference(
  p_id         uuid,
  p_reference  text,
  p_proof_url  text default null,
  p_notes      text default null,
  p_payer_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner uuid := auth.uid();
  v_rec   public.international_payments%rowtype;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  if p_reference is null or btrim(p_reference) = '' then
    raise exception 'Payment reference is required' using errcode = 'check_violation';
  end if;

  select * into v_rec from public.international_payments
   where id = p_id and owner_id = v_owner for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found.');
  end if;
  if v_rec.status not in ('pending','submitted') then
    return jsonb_build_object('success', false, 'error', 'This request is already ' || v_rec.status || '.');
  end if;

  update public.international_payments
     set user_submitted_reference = btrim(p_reference),
         payment_proof_url        = nullif(btrim(coalesce(p_proof_url, '')), ''),
         notes                    = nullif(btrim(coalesce(p_notes, '')), ''),
         payer_name               = nullif(btrim(coalesce(p_payer_name, '')), ''),
         status                   = 'submitted'
   where id = p_id;

  return jsonb_build_object('success', true, 'status', 'submitted', 'id', p_id);
end;
$$;
grant execute on function public.app_submit_intl_reference(uuid, text, text, text, text) to authenticated;

-- 6. Review RPC (admin only) — approve activates the plan; reject keeps it off.
--    Duplicate-approval guarded by the status check under a row lock (FOR UPDATE).
create or replace function public.app_review_intl_payment(
  p_id     uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin uuid := auth.uid();
  v_rec   public.international_payments%rowtype;
  v_start timestamptz;
  v_end   timestamptz;
begin
  if not public.is_platform_admin() then
    raise exception 'not authorized' using errcode = 'insufficient_privilege';
  end if;

  select * into v_rec from public.international_payments where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error', 'Payment not found.');
  end if;
  if v_rec.status <> 'submitted' then
    return jsonb_build_object('success', false, 'error',
      case when v_rec.status = 'pending'
           then 'The owner has not submitted a payment reference yet.'
           else 'This request is already ' || v_rec.status || '.' end);
  end if;

  if lower(p_action) = 'approve' then
    v_start := now();
    v_end   := now() + case when v_rec.billing_cycle = 'yearly' then interval '365 days' else interval '30 days' end;

    -- Authorized plan write — honored by the 20260621 plan-column lockdown trigger.
    -- plan_tier drives every feature gate (src/lib/plans.ts), so access follows.
    perform set_config('app.allow_plan_write', 'on', true);
    update public.gym_settings
       set plan_tier          = v_rec.plan_tier,
           plan_type          = initcap(v_rec.plan_tier),
           plan_status        = 'active',
           billing_cycle      = v_rec.billing_cycle,
           subscription_start = v_start,
           expiry_date        = v_end,
           trial_ends_at      = null
     where gym_owner_id = v_rec.owner_id;

    update public.international_payments
       set status = 'approved', approved_by = v_admin, approved_at = now(),
           current_period_start = v_start, current_period_end = v_end
     where id = p_id;

    begin
      insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
      values (v_rec.owner_id, 'subscription',
              'Your ' || initcap(v_rec.plan_tier) || ' plan is now active — valid till ' || to_char(v_end, 'DD Mon YYYY') || '.',
              false);
    exception when others then null;
    end;

    return jsonb_build_object('success', true, 'status', 'approved', 'tier', v_rec.plan_tier, 'expiry', v_end);

  elsif lower(p_action) = 'reject' then
    update public.international_payments
       set status = 'rejected', reject_reason = p_reason, approved_by = v_admin, approved_at = now()
     where id = p_id;

    begin
      insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
      values (v_rec.owner_id, 'subscription',
              'Your ' || initcap(v_rec.plan_tier) || ' plan payment was not approved' ||
              case when p_reason is not null and btrim(p_reason) <> '' then ': ' || p_reason else '.' end,
              false);
    exception when others then null;
    end;

    return jsonb_build_object('success', true, 'status', 'rejected');
  else
    raise exception 'invalid action %', p_action using errcode = 'check_violation';
  end if;
end;
$$;
grant execute on function public.app_review_intl_payment(uuid, text, text) to authenticated;

-- 7. Admin-enriched list — joins gym_settings for the Gym name + Owner email the
--    dashboard shows. Admin-gated (non-admins get an empty set).
drop function if exists public.app_admin_list_intl_payments(int);
create function public.app_admin_list_intl_payments(p_limit int default 200)
returns table (
  id                       uuid,
  owner_id                 uuid,
  gym_id                   uuid,
  plan_tier                text,
  billing_cycle            text,
  country                  text,
  country_tier             int,
  currency                 text,
  amount                   numeric,
  gateway                  text,
  payment_reference_id     text,
  user_submitted_reference text,
  payment_proof_url        text,
  notes                    text,
  payer_name               text,
  status                   text,
  reject_reason            text,
  current_period_start     timestamptz,
  current_period_end       timestamptz,
  approved_at              timestamptz,
  approved_by              uuid,
  created_at               timestamptz,
  gym_name                 text,
  owner_email              text
)
language sql
stable
security definer
set search_path = public
as $$
  select ip.id, ip.owner_id, ip.gym_id, ip.plan_tier, ip.billing_cycle, ip.country,
         ip.country_tier, ip.currency, ip.amount, ip.gateway, ip.payment_reference_id,
         ip.user_submitted_reference, ip.payment_proof_url, ip.notes, ip.payer_name,
         ip.status, ip.reject_reason, ip.current_period_start, ip.current_period_end,
         ip.approved_at, ip.approved_by, ip.created_at,
         coalesce(gs.gym_name, '')    as gym_name,
         coalesce(gs.owner_email, '') as owner_email
  from public.international_payments ip
  left join public.gym_settings gs on gs.gym_owner_id = ip.owner_id
  where public.is_platform_admin()
  order by ip.created_at desc
  limit greatest(coalesce(p_limit, 200), 0);
$$;
grant execute on function public.app_admin_list_intl_payments(int) to authenticated;

commit;

notify pgrst, 'reload schema';

-- ============================================================================
-- Post-apply:
--   • Set the Payoneer payee from the admin dashboard, or:
--       select app_set_platform_payoneer('billing@gymphony.app','Gymphony Pvt Ltd',
--              'Include the reference ID in the Payoneer note','+91...','support@gymphony.app');
--   • Verification:
--       - app_create_intl_payment('growth','US') -> amount 50, USD, a GYM-INTL- ref
--       - app_create_intl_payment('growth','IN') -> raises (India uses UPI)
--       - app_create_intl_payment('pro','US')    -> raises (Pro waitlist) until enabled
--       - submit a reference -> status 'submitted'; approving twice -> "already approved"
--       - approve -> gym_settings.plan_tier set, expiry/period filled, activity_log row
--       - duplicate user_submitted_reference insert -> 23505
-- ============================================================================
