-- =============================================================================
-- 20260707 — Member identity canonicalization + Add-Member / Join-QR indexes.
-- -----------------------------------------------------------------------------
-- ROOT CAUSE (manual "Add Member" failing with
--   "Could not find the 'auth_user_id' column of 'members' in the schema cache"):
-- the client wrote an `auth_user_id` column that DOES NOT EXIST, INTO a relation
-- that is also NOT insertable. In this database `public.members` is a READ-ONLY
-- VIEW (profiles ⋈ gym_settings, to surface gym_owner_id) — it has no INSTEAD-OF
-- INSERT trigger, so writing it fails with "cannot insert into view 'members'".
-- Member rows live in the BASE table `public.profiles`. The canonical identity is:
--
--        members.id  =  profiles.id  =  auth.users.id   (for account holders)
--
-- IMPORTANT: profiles.id IS FK-bound to auth.users (profiles_id_fkey) — a member
-- row can only exist for a REAL auth account, so owner-added OFFLINE members can't
-- be profiles rows. They live in `public.member_invites` (migration 20260708) and
-- are claimed into a profiles row when the person signs up via Join-QR. When they
-- sign up they get their OWN profiles row keyed by auth.uid(); the member portal,
-- kiosk, leaderboard, payments and approval RPCs ALL key on this id. There is
-- intentionally NO `auth_user_id` column — adding one to a VIEW would require
-- rewriting the view + every id-based query, breaking existing members. The app
-- code has been aligned to this model (stray auth_user_id writes removed); this
-- migration only documents the contract and adds covering indexes for the owner
-- Add-Member / member-list queries.
--
-- Membership lifecycle (unchanged, enforced elsewhere):
--   • New members are inserted as status='Pending'.
--   • Only the gym owner's verified-payment approval flips status to 'Active'
--     (approve_payment → app_activate_member, the single authorized writer; the
--     20260607 BEFORE-UPDATE lockdown on profiles blocks client self-activation).
--
-- NOTE on `source` (manual | join_qr): NOT added here. It would have to live on
-- `profiles` AND be surfaced/writable through the `members` view, whose exact DDL
-- is maintained outside this repo; writing it through the view from the client
-- would reproduce the very "column not in schema cache" class of failure. Track
-- it as a follow-up that ships together with a regenerated view definition.
--
-- Everything below is additive + idempotent (CREATE INDEX IF NOT EXISTS) and is
-- safe to re-run. It does not alter any column, policy, trigger, or existing row.
-- =============================================================================

begin;

-- Owner member-list + duplicate-phone pre-check (dashboard.tsx handleSaveMember,
-- MembersList.tsx, fetchMembersCounts) filter profiles by gym_owner_id / gym_id.
create index if not exists profiles_gym_owner_id_idx on public.profiles (gym_owner_id);
create index if not exists profiles_gym_id_idx       on public.profiles (gym_id);

-- The Add-Member duplicate guard looks up an existing member by phone within the
-- owner's gym (.or(mobile_number.eq.., phone.eq..)). Index both synonyms.
create index if not exists profiles_mobile_number_idx on public.profiles (mobile_number);
create index if not exists profiles_phone_idx         on public.profiles (phone);

commit;

-- Ask PostgREST to refresh its schema cache (harmless if it already matches).
notify pgrst, 'reload schema';
