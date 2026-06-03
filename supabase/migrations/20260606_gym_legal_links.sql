-- =============================================================================
-- Legal & Compliance links (Step 3) — required for payment-gateway approval.
-- The owner pastes their public policy URLs; these surface in the member app /
-- checkout footer so the gateway (Razorpay/Stripe) sees compliant disclosures.
--
-- Canonical gym entity is public.gym_settings (no separate "gyms" table).
-- Idempotent; safe to run multiple times.
-- =============================================================================

alter table public.gym_settings add column if not exists terms_url   text;
alter table public.gym_settings add column if not exists privacy_url text;
alter table public.gym_settings add column if not exists refund_url  text;

-- Existing owner SELECT/UPDATE RLS on gym_settings already covers these columns.
-- Members already read gym_settings, so the footer links are readable client-side.
