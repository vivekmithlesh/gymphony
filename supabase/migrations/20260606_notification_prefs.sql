-- =============================================================================
-- Owner notification preferences (Settings → Notifications tab).
-- Boolean toggles the owner controls; default ON so existing gyms keep alerts.
--
-- Canonical gym entity is public.gym_settings (no separate "gyms" table).
-- Idempotent; safe to run multiple times.
-- =============================================================================

alter table public.gym_settings add column if not exists notify_new_member      boolean not null default true;
alter table public.gym_settings add column if not exists notify_pending_payment boolean not null default true;
alter table public.gym_settings add column if not exists notify_low_stock       boolean not null default true;

-- Existing owner SELECT/UPDATE RLS on gym_settings already covers these columns.
