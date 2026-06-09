-- =============================================================================
-- gym_plans.plan_name — align the live table with what the app expects
-- -----------------------------------------------------------------------------
-- The "Add plan failed: Could not find the 'plan_name' column of 'gym_plans' in
-- the schema cache" error is NOT a stale cache — the column genuinely does not
-- exist on the live gym_plans table (created manually; no CREATE TABLE in repo).
--
-- The rest of the app already expects gym_plans.plan_name: the plan form writes
-- name + plan_name in sync (SettingsView), WhatsAppBotWidget selects plan_name,
-- and approve_payment / app_simulate_online_payment match plans on
-- (gp.name = v_plan OR gp.plan_name = v_plan). So the correct fix is to add the
-- missing column (not to strip plan_name from the client), keeping name and
-- plan_name as synonyms.
--
-- duration_days is added defensively for the same reason (the form writes it and
-- readers select it). Both adds are no-ops if the columns already exist.
-- Idempotent; safe to re-run. After running, PostgREST reloads its schema cache.
--
-- NOTE: assumes gym_plans is a TABLE. If it is a VIEW, add the column to the
-- underlying base table / redefine the view instead.
-- =============================================================================

alter table public.gym_plans add column if not exists plan_name    text;
alter table public.gym_plans add column if not exists duration_days integer;

-- Backfill so existing rows are consistent (name <-> plan_name, months -> days).
-- gym_plans.duration is stored as TEXT in the live DB, so cast through text->int
-- with a numeric guard (mirrors approve_payment) instead of plain arithmetic.
update public.gym_plans set plan_name = name where plan_name is null and name is not null;
update public.gym_plans
   set duration_days = (duration)::text::int * 30
 where duration_days is null
   and (duration)::text ~ '^[0-9]+$';

-- Tell PostgREST to pick up the new columns immediately (the reload the error hinted at).
notify pgrst, 'reload schema';
