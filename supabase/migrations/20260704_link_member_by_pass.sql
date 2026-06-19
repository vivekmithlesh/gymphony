-- =============================================================================
-- 20260704 — "Scan to Add Member" / "Add by ID": server-authoritative member
-- resolution + gym linking.
-- -----------------------------------------------------------------------------
-- BUG: the owner-side "Add Member" flow (scan a member's Virtual ID Card, or
-- type their ID) ran ENTIRELY client-side:
--     supabase.from("profiles").select(...).eq("id", uuid)     -- preview
--     supabase.from("profiles").update({ gym_id }).eq("id", …) -- the link
-- Both hit `profiles` DIRECTLY from the owner's session. `profiles` has RLS, and
-- "an owner cannot read/update ANOTHER user's profiles row under RLS" (the same
-- reason 20260611_expire_overdue_members and the payments hardening use definer
-- RPCs). So for a member not yet in the owner's gym the SELECT returned no row
-- and the UPDATE silently no-op'd → the UI showed "Member Not Found".
--
-- The KIOSK check-in works because it goes through the SECURITY DEFINER
-- kiosk_check_in RPC, which bypasses RLS. This migration gives "Add Member" the
-- same treatment so BOTH scanners share one consistent, RLS-safe member lookup:
--   • lookup_member_for_link(ref) → resolve a member by UUID or short_id for the
--     "Profile Found" preview (read-only).
--   • link_member_to_gym(ref)     → associate that member with the CALLER's gym,
--     with explicit, distinguishable outcomes (not_found / already_added /
--     other_gym / no_gym / invalid_ref / linked).
--
-- `ref` is the member's profiles.id (== auth.uid() == the `mid` a member pass
-- encodes) OR their short_id — never the short display label (GYM-MEMBER-XXX),
-- which is cosmetic only. gym_id / gym_owner_id are NOT lockdown-protected
-- columns (20260607 only guards status/plan/expiry), so no allow-flag is needed;
-- the write needs definer rights purely to clear RLS.
--
-- Idempotent; safe to re-run. Does NOT touch the kiosk_check_in path.
-- =============================================================================

begin;

-- Shared UUID test (matches the client-side regex used by the Add Member UI).
-- ref ~* this == "looks like a UUID" → match profiles.id, else → short_id.
-- (Comparing the uuid column against a non-UUID literal errors in Postgres, so
--  the branch matters.)

-- ---------------------------------------------------------------------
-- 1. lookup_member_for_link(ref) — read-only preview resolver.
-- ---------------------------------------------------------------------
create or replace function public.lookup_member_for_link(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid := auth.uid();
  v_ref     text := nullif(trim(p_ref), '');
  v_is_uuid boolean;
  v_id      uuid;
  v_name    text;
  v_avatar  text;
  v_short   text;
  v_mowner  uuid;
begin
  if v_owner is null then
    return jsonb_build_object('found', false, 'code', 'unauthenticated');
  end if;

  -- Only gym owners may resolve members (limits name/avatar exposure).
  if not exists (select 1 from public.gym_settings where gym_owner_id = v_owner) then
    return jsonb_build_object('found', false, 'code', 'no_gym');
  end if;

  if v_ref is null then
    return jsonb_build_object('found', false, 'code', 'invalid_ref');
  end if;

  v_is_uuid := v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if v_is_uuid then
    select id, full_name, avatar_url, short_id, gym_owner_id
      into v_id, v_name, v_avatar, v_short, v_mowner
    from public.profiles where id = v_ref::uuid;
  else
    select id, full_name, avatar_url, short_id, gym_owner_id
      into v_id, v_name, v_avatar, v_short, v_mowner
    from public.profiles where short_id = v_ref;
  end if;

  if v_id is null then
    return jsonb_build_object('found', false, 'code', 'not_found');
  end if;

  return jsonb_build_object(
    'found',         true,
    'id',            v_id,
    'full_name',     v_name,
    'avatar_url',    v_avatar,
    'short_id',      v_short,
    'already_in_gym', (v_mowner = v_owner),
    'other_gym',      (v_mowner is not null and v_mowner <> v_owner),
    'lookup',        case when v_is_uuid then 'uuid' else 'short_id' end
  );
end;
$$;

revoke all on function public.lookup_member_for_link(text) from public, anon;
grant execute on function public.lookup_member_for_link(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2. link_member_to_gym(ref) — associate the member with the caller's gym.
-- ---------------------------------------------------------------------
create or replace function public.link_member_to_gym(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner   uuid := auth.uid();
  v_gym     uuid;
  v_ref     text := nullif(trim(p_ref), '');
  v_is_uuid boolean;
  v_id      uuid;
  v_name    text;
  v_short   text;
  v_mowner  uuid;
begin
  if v_owner is null then
    return jsonb_build_object('success', false, 'code', 'unauthenticated',
      'error', 'Not signed in.');
  end if;

  select id into v_gym from public.gym_settings where gym_owner_id = v_owner;
  if v_gym is null then
    return jsonb_build_object('success', false, 'code', 'no_gym',
      'error', 'Finish your gym setup before adding members.');
  end if;

  if v_ref is null then
    return jsonb_build_object('success', false, 'code', 'invalid_ref',
      'error', 'Invalid QR / member ID.');
  end if;

  v_is_uuid := v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  if v_is_uuid then
    select id, full_name, short_id, gym_owner_id
      into v_id, v_name, v_short, v_mowner
    from public.profiles where id = v_ref::uuid;
  else
    select id, full_name, short_id, gym_owner_id
      into v_id, v_name, v_short, v_mowner
    from public.profiles where short_id = v_ref;
  end if;

  if v_id is null then
    return jsonb_build_object('success', false, 'code', 'not_found',
      'error', 'No member exists for that QR / ID.');
  end if;

  -- Already one of THIS owner's members → idempotent, report clearly.
  if v_mowner = v_owner then
    return jsonb_build_object('success', false, 'code', 'already_added',
      'member_name', v_name,
      'error', coalesce(v_name, 'This member') || ' is already in your gym.');
  end if;

  -- Belongs to a DIFFERENT gym → never silently transfer them.
  if v_mowner is not null and v_mowner <> v_owner then
    return jsonb_build_object('success', false, 'code', 'other_gym',
      'member_name', v_name,
      'error', 'This member belongs to another gym.');
  end if;

  -- Unaffiliated member → link to this gym. Definer rights clear profiles RLS;
  -- gym_id / gym_owner_id are not lockdown-protected, so no allow-flag needed.
  update public.profiles
     set gym_id       = v_gym,
         gym_owner_id = v_owner
   where id = v_id;

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (v_owner, 'member',
          coalesce(v_name, 'A member') || ' was added to your gym.', false);

  return jsonb_build_object(
    'success',     true,
    'code',        'linked',
    'member_id',   v_id,
    'member_name', v_name,
    'short_id',    v_short,
    'lookup',      case when v_is_uuid then 'uuid' else 'short_id' end
  );
end;
$$;

revoke all on function public.link_member_to_gym(text) from public, anon;
grant execute on function public.link_member_to_gym(text) to authenticated;

commit;

notify pgrst, 'reload schema';
