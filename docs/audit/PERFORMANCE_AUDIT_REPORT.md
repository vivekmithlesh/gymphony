# Gymphony — Performance & Scalability Audit

> Read-only. Targets: 10 → 100 → 1,000 → 10,000 gyms.

---

## 1. Frontend

| Issue | Evidence | Impact |
|---|---|---|
| 2,585-line owner route loads everything eagerly | `src/routes/dashboard.tsx` | Large initial JS, many hooks fire on mount; slow TTI on mid-range mobile |
| No code-splitting of heavy libs beyond what's required | `xlsx`, `recharts`, `leaflet`, `html5-qrcode`, `framer-motion` all in deps | Bundle weight; leaflet must stay client-only (already noted in project memory) |
| Three payment SDKs shipped | `@stripe/*`, `razorpay-checkout`, `phonepe.ts` | Dead bundle weight + parse cost |
| No TanStack Query despite dependency | direct `useEffect` fetches in `dashboard.tsx`, `member-dashboard.tsx` | No request dedup/cache → repeated identical fetches, re-render storms |
| Duplicate `gym_settings` fetch per page | `usePlanAccess.ts:44` + `ProtectedProRoute.tsx:31` + `dashboard.tsx` own fetch | Same row fetched 2–3× per render tree |

**Recommendation:** introduce a single `SubscriptionProvider` (mirror `AuthProvider`) that
fetches `gym_settings` once and exposes `hasFeature()` + the resolved subscription to all
consumers; lazy-load Revenue/Inventory/Leaderboard/AI tabs; drop unused payment SDKs.

---

## 2. Backend (Postgres / PostgREST)

| Issue | Evidence | Impact at scale |
|---|---|---|
| Unbounded `gym_plans` select | `dashboard.tsx:538` (`select('*')`, no filter, no limit) | Reads whole table; client filters — worse as plan catalog grows |
| Unbounded members fallback | `dashboard.tsx:556-559` (no `.limit()`) | A 5,000-member gym loads all rows to derive distinct plan names |
| `fetchMembersCounts` heavy path | per project memory (scale-validation) — 3 unbounded queries | Dominant cost on large gyms |
| Missing index `profiles(gym_id, expiry_date)` | `expire_overdue_members` (`20260611`) | Full scan during expiry sweep |
| Missing index `workout_logs(gym_id, created_at)` | `get_city_gym_leaderboard` (`20260623`) | Expensive monthly aggregation |
| Leaderboard aggregates on read | `get_city_gym_leaderboard` | Recomputed per request; no materialization |

**Recommendation:** add the two missing indexes; bound every list query with `.limit()` +
keyset pagination; replace "fetch all then derive" with purpose-built aggregate RPCs;
materialize leaderboards (see scale plan).

---

## 3. Database growth & retention

- **`activity_log` has no retention/partition strategy** and is written on every check-in,
  purchase, and payment. At 10,000 gyms this is the fastest-growing table and the one most
  read by realtime. It needs monthly partitioning + a retention window (e.g. 90 days) and a
  per-tenant index `(gym_owner_id, created_at desc)` (the index exists; the table DDL does not — S-1).
- **`check_ins`** grows linearly with attendance; already indexed `(gym_id, check_in_time)`.
  Add retention/rollup for heatmaps beyond N months.

---

## 4. Realtime fan-out

Realtime is enabled on `workout_logs`, `check_ins`, `activity_log`, `gym_settings`,
`gym_profiles`, `member_notes` (`20260602_member_owner_realtime.sql`). Every owner dashboard
and member dashboard opens subscriptions. At 10,000 concurrent gyms this is the **first hard
ceiling** (Supabase Realtime connection + message limits). Plan: scope subscriptions
tightly (already filtered by `gym_id`/owner), debounce refetches, and consider polling
fallbacks for low-priority feeds.

---

## 5. Scale migration plan

| Tier | Gyms | Bottleneck | Action |
|---|---|---|---|
| **10** | now | none | Land correctness fixes (gating, activity_log, QR). |
| **100** | ~50k members | duplicate fetches, unbounded queries | SubscriptionProvider; bound all list queries; add missing indexes. |
| **1,000** | ~500k | leaderboard aggregation, activity_log growth, realtime | Materialized leaderboards (cron refresh); partition `activity_log` + retention; keyset pagination everywhere. |
| **10,000** | ~5M | realtime ceiling, hot single project, cron throughput | Connection pooling (Supavisor); read replicas for analytics; shard heavy realtime to dedicated channels; move expiry/cleanup sweeps from owner-triggered RPCs to scheduled `pg_cron`/edge cron; consider per-region projects. |

---

## 6. Quick wins (high value / low effort)

1. Add `.eq("gym_owner_id", userId)` + `.limit()` to `gym_plans`/members queries
   (`dashboard.tsx:538,556`). — correctness + perf.
2. Add `profiles(gym_id, expiry_date)` and `workout_logs(gym_id, created_at)` indexes.
3. Centralize `gym_settings` into one provider to kill duplicate fetches.
4. Remove unused payment SDKs from `package.json`.
5. Move `expire_overdue_members` / `expire_stale_store_purchases` onto `pg_cron`.
