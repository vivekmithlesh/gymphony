-- =============================================================================
-- 20260712 — profiles RLS + members-view tenant isolation (authenticated layer).
-- -----------------------------------------------------------------------------
-- 20260711 stopped ANON reads. This closes the AUTHENTICATED cross-tenant hole:
-- with RLS off, any logged-in member could read/update other gyms' members. We
-- enable RLS on profiles with tenant-scoped policies AND make the `members` view
-- security_invoker so it stops bypassing RLS (today any authenticated user can
-- dump every gym's members through the view).
--
-- ⚠️ APPLY AFTER 20260709/20260710/20260711 and AFTER a smoke test on a branch if
-- possible. The protected-column enforcement stays with the existing triggers
-- (20260607 status/plan/expiry, 20260628 role) — these policies add ROW scoping,
-- not column rules. All SECURITY DEFINER RPCs (approve_payment, app_activate_member,
-- app_request_gym_switch, app_claim_member_invite, app_add_member_invite,
-- app_self_checkin, expire_overdue_members, mark_notifications_read) bypass RLS,
-- so activation/check-in/invite flows are unaffected.
--
-- Post-apply smoke test (must pass): owner Members list loads; member dashboard
-- loads; city leaderboard loads; check-in works; member edits own name.
-- Rollback: alter view public.members set (security_invoker = false);
--           alter table public.profiles disable row level security;
--
-- Idempotent; safe to re-run.
-- =============================================================================

begin;

-- Caller's gym_id WITHOUT recursing into profiles RLS (definer bypasses RLS).
-- Used by the same-gym SELECT policy so a profiles policy never selects profiles.
create or replace function public.app_caller_gym_id()
returns uuid language sql security definer stable set search_path = public as $$
  select gym_id from public.profiles where id = auth.uid() limit 1;
$$;
revoke all on function public.app_caller_gym_id() from public, anon;
grant execute on function public.app_caller_gym_id() to authenticated;

alter table public.profiles enable row level security;

-- SELECT: own row, OR members of the gym you own (owner list), OR gym-mates in
-- your own gym (leaderboard/community — matches the intent of 20260602).
drop policy if exists "Members can view gym-mate profiles" on public.profiles; -- superseded
drop policy if exists profiles_select_scoped on public.profiles;
create policy profiles_select_scoped on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or gym_owner_id = auth.uid()
    or (gym_id is not null and gym_id = public.app_caller_gym_id())
  );

-- INSERT: self-provisioning only (signup/onboarding). The 20260628 role trigger
-- still forces role='member'; owners become owners via app_register_owner.
drop policy if exists profiles_insert_self on public.profiles;
create policy profiles_insert_self on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

-- UPDATE: a member updates only their OWN row; an owner updates rows in their own
-- gym. Protected columns (status/plan/expiry/role) remain blocked for non-owners
-- by the existing BEFORE-UPDATE triggers, so a member still cannot self-activate.
drop policy if exists profiles_update_scoped on public.profiles;
create policy profiles_update_scoped on public.profiles
  for update to authenticated
  using (id = auth.uid() or gym_owner_id = auth.uid())
  with check (id = auth.uid() or gym_owner_id = auth.uid());

-- DELETE: only the gym owner may remove one of their own members.
drop policy if exists profiles_delete_owner on public.profiles;
create policy profiles_delete_owner on public.profiles
  for delete to authenticated
  using (gym_owner_id = auth.uid());

-- Make the members view respect the caller's RLS (PG15+). Without this the view
-- runs as its owner and bypasses every policy above — the second leak vector.
alter view public.members set (security_invoker = true);

commit;

notify pgrst, 'reload schema';
