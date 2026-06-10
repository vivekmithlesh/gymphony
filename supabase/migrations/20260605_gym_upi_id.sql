-- =============================================================================
-- Gym UPI ID — zero-fee member payments (Flow 2, Step A).
-- The owner saves their UPI handle (e.g. gymname@ybl) so members can pay fees
-- and store items directly via a generated UPI QR, with no platform cut.
--
-- Canonical gym entity is public.gym_settings (no separate "gyms" table).
-- Idempotent; safe to run multiple times.
-- =============================================================================

alter table public.gym_settings
  add column if not exists upi_id text;

-- Existing owner SELECT/UPDATE RLS on gym_settings already covers this column;
-- no policy change needed. The member-facing read of upi_id for checkout is
-- added in Flow 2 Step B (member dashboard) with a scoped SELECT policy.
