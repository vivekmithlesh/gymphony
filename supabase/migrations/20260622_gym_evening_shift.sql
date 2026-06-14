-- ============================================================================
-- 20260622_gym_evening_shift.sql
-- Optional second ("evening") operating shift for gyms that close mid-afternoon
-- (e.g. morning 05:00–10:00, evening 16:00–22:00).
--
-- DESIGN CHOICE — two nullable TEXT columns, NOT a JSONB shifts array.
--   opening_time / closing_time are read directly in many places
--   (CityGymExplorer, GymDetailView, GymDetailsModal, WhatsAppBotWidget, the
--   member dashboard). Keeping them as the mandatory FIRST (morning) shift and
--   adding two columns for the optional evening shift is fully backward
--   compatible — no reader changes, trivial to query
--   (e.g. `where evening_opening_time is not null`), and matches the existing
--   "HH:MM" 24-hour string format the TimePicker already stores.
--
-- Idempotent; safe to re-run.
-- ============================================================================

alter table public.gym_settings add column if not exists evening_opening_time text;
alter table public.gym_settings add column if not exists evening_closing_time text;

comment on column public.gym_settings.evening_opening_time is
  'Optional 2nd-shift opening time ("HH:MM" 24h). NULL = single continuous shift.';
comment on column public.gym_settings.evening_closing_time is
  'Optional 2nd-shift closing time ("HH:MM" 24h). NULL = single continuous shift.';
