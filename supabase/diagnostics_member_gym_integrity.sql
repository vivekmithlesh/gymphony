-- =============================================================================
-- Member ↔ gym integrity check (for the Wall QR / Kiosk check-in flow).
--
-- Two columns gate a member to a gym:
--   • members.gym_owner_id  — the CANONICAL key. The kiosk cross-gym guard and
--                             the check_ins RLS policy both authorize on this.
--                             A NULL here lets a member check in at ANY gym.
--   • members.gym_id        — used by the QR payload, leaderboard & store scope.
--
-- Run sections 1–3 (read-only) first. Only run section 4 (backfill) after you
-- have eyeballed what 1–3 return. Everything is idempotent and safe to re-run.
-- =============================================================================

-- 1. SECURITY-CRITICAL: members with no owner → checkable at any kiosk.
select id, full_name, email, status, gym_id, gym_owner_id, joining_date
from public.members
where gym_owner_id is null
order by joining_date desc nulls last;

-- 2. The column you asked about: members with no gym_id (breaks QR gym-binding,
--    leaderboard attribution, and member-store scoping).
select id, full_name, email, status, gym_id, gym_owner_id, joining_date
from public.members
where gym_id is null
order by joining_date desc nulls last;

-- 3. INCONSISTENT: gym_id points at a gym whose owner ≠ the member's gym_owner_id
--    (a stale/cross-wired link — would make the QR's gym disagree with the guard).
select m.id, m.full_name, m.gym_id, m.gym_owner_id,
       g.gym_owner_id as gym_settings_owner
from public.members m
join public.gym_settings g on g.id = m.gym_id
where m.gym_owner_id is not null
  and g.gym_owner_id is not null
  and m.gym_owner_id <> g.gym_owner_id;

-- ── Counts at a glance ───────────────────────────────────────────────────────
select
  count(*) filter (where gym_owner_id is null) as missing_owner,
  count(*) filter (where gym_id is null)        as missing_gym_id,
  count(*)                                       as total_members
from public.members;

-- =============================================================================
-- 4. BACKFILL (run only after reviewing 1–3). Repairs nulls where the OTHER key
--    can supply the answer via gym_settings. Rows still null after this have
--    neither key set and need manual attention (or deletion).
-- =============================================================================

-- 4a. Fill gym_owner_id from gym_id → gym_settings.gym_owner_id.
-- update public.members m
--   set gym_owner_id = g.gym_owner_id
--   from public.gym_settings g
--  where m.gym_id = g.id
--    and m.gym_owner_id is null
--    and g.gym_owner_id is not null;

-- 4b. Fill gym_id from gym_owner_id → gym_settings.id (one gym per owner).
-- update public.members m
--   set gym_id = g.id
--   from public.gym_settings g
--  where m.gym_owner_id = g.gym_owner_id
--    and m.gym_id is null;

-- 4c. Last-resort fallback: derive the owner from the member's profile gym.
-- update public.members m
--   set gym_owner_id = g.gym_owner_id,
--       gym_id       = coalesce(m.gym_id, g.id)
--   from public.profiles p
--   join public.gym_settings g on g.id = p.gym_id
--  where p.id = m.id
--    and m.gym_owner_id is null
--    and g.gym_owner_id is not null;
