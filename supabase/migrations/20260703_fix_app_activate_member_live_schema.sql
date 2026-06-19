-- =============================================================================
-- 20260703 — Fix app_activate_member: write only columns present in live profiles.
-- -----------------------------------------------------------------------------
-- BUG: app_activate_member (last defined in 20260613) did:
--   update public.profiles
--      set status = 'Active', subscription_status = 'Active', membership_plan = …,
--          subscription_start = now(), subscription_end_date = p_expiry,
--          expiry_date = p_expiry …
-- but the LIVE profiles table has NO subscription_status and NO subscription_end_date
-- columns — membership state is tracked by `status` + `expiry_date` (documented
-- drift; the member UI was already switched to read those). So the second approve
-- step threw: column "subscription_status" of relation "profiles" does not exist,
-- blocking every member-payment approval (after the 20260702 text*integer fix).
--
-- FIX: write only the columns that exist (status, membership_plan, subscription_start,
-- expiry_date). expiry_date is the authoritative membership end; status is the
-- authoritative active/inactive flag. subscription_start is added defensively in
-- case 20260613 wasn't fully applied. The lockdown trigger (app_lock_membership_columns)
-- already guards each column with `newj ? col`, so dropped columns are simply skipped.
-- Idempotent (create or replace + add column if not exists); safe to re-run.
-- =============================================================================

begin;

-- Keep this one (matches 20260613); defensive in case it wasn't applied.
alter table public.profiles add column if not exists subscription_start timestamptz;

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
  -- Authorize the protected-column write (BEFORE-UPDATE lockdown from 20260607/13).
  perform set_config('app.allow_membership_write', 'on', true);

  -- Only columns that exist in the live profiles schema. NO subscription_status /
  -- subscription_end_date — they don't exist; status + expiry_date are canonical.
  update public.profiles
     set status             = 'Active',
         membership_plan    = coalesce(p_plan, membership_plan),
         subscription_start = now(),
         expiry_date        = p_expiry
   where id = p_member;
end;
$$;

revoke all on function public.app_activate_member(uuid, text, timestamptz) from public;
revoke all on function public.app_activate_member(uuid, text, timestamptz) from anon, authenticated;

commit;

notify pgrst, 'reload schema';
