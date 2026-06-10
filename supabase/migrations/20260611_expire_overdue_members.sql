-- =============================================================================
-- Auto-expire overdue members (owner-triggered, fetch-time sweep).
-- -----------------------------------------------------------------------------
-- The dashboard used to mark expired members 'Inactive' with a client-side
-- `update public.members ...`, but `members` is a non-updatable JOIN view AND an
-- owner cannot update another user's `profiles` row under RLS. So the write
-- silently no-op'd and expired members stayed 'Active'.
--
-- This SECURITY DEFINER RPC does it correctly: it flips the CALLING owner's own
-- members (scoped via gym_settings.gym_owner_id = auth.uid()) from active →
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
