-- =============================================================================
-- Campaign auto-expiry (scheduled) — flips expired campaigns to is_active=false.
-- -----------------------------------------------------------------------------
-- Members are ALREADY protected by lazy expiry: the member-read RLS policy and
-- the purchase RPC both ignore campaigns past `ends_at`. This job is purely for
-- clean owner-side reporting — so an ended campaign's `is_active` reflects reality
-- instead of staying true forever.
--
-- Runs every 15 minutes via pg_cron. Idempotent; safe to re-run.
-- =============================================================================

-- 1. Enable pg_cron (Supabase ships it; the scheduler lives in the `cron` schema).
create extension if not exists pg_cron;

-- 2. The cleanup function: deactivate campaigns whose end time has passed.
create or replace function public.deactivate_expired_campaigns()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.campaigns
    set is_active = false,
        updated_at = now()
  where is_active = true
    and ends_at is not null
    and ends_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- 3. (Re)schedule the job every 15 minutes. Unschedule any prior version first
--    so re-running this migration doesn't create duplicate jobs.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'deactivate-expired-campaigns') then
    perform cron.unschedule('deactivate-expired-campaigns');
  end if;
end $$;

select cron.schedule(
  'deactivate-expired-campaigns',
  '*/15 * * * *',
  $$ select public.deactivate_expired_campaigns(); $$
);
