# Gymphony — Architecture Audit Report

> Read-only. Scores are 0–10 with reasoning. All claims cite file/line.

---

## 1. Architecture at a glance

```
                       ┌─────────────────────────────────────────┐
                       │            Browser (React 19)            │
                       │  TanStack Start SSR/SPA · TanStack Router │
                       └───────────────┬──────────────────────────┘
                                       │ supabase-js (anon JWT)
                                       │  DIRECT to Postgres — no app server
              ┌────────────────────────┼──────────────────────────────┐
              ▼                        ▼                               ▼
      PostgREST (tables/views)   RPC (SECURITY DEFINER)         Realtime (WS)
      profiles/members view      process_wall_checkin           activity_log
      gym_settings               approve_payment                check_ins
      payments / purchases       log_workout_session            gym_settings
      inventory / campaigns      app_set_owner_plan (svc role)  member_notes
      activity_log (no DDL!)     get_city_gym_leaderboard
              │                        │
              └──────────┬─────────────┘
                         ▼
                 RLS + triggers + GUC-flag lockdowns
                 (membership cols, plan cols, vibe_points)
```

**Architecture style:** "Postgres-as-backend" / BaaS. There is **no Node/edge API tier of
our own**; `supabase.ts` is the only gateway and every component talks to the DB directly.
Trust boundary = Postgres (RLS/RPC). This is a legitimate pattern at small scale and the
team has used it well for the *security-critical* paths. The risk is that **non-critical
but correctness-sensitive logic (gating UX, notifications, denormalized counters) leaks
into the untrusted client** and drifts.

---

## 2. Dependency graph (module level, verified imports)

```
plans.ts  ─────────────┬──────────────► permissions.ts ──► InventoryManager, SettingsView
 (SSOT: PLANS,         │                                    (subscriptionHasFeature/Feature map)
  FEATURE_MIN_TIER,    │
  AppFeature map)      ├──────────────► usePlanAccess.ts ─► DashboardLayout (nav)
                       │                                    FeatureRouteGuard ─► city-leaderboard
                       ├──────────────► ProtectedProRoute ─► RevenueView, InventoryManager
                       └──────────────► dashboard.tsx (imports BOTH planAllows AND
                                         subscriptionHasFeature AND <FeatureLock/>)

FeatureLock.tsx  ──► (self-contained, isPro hardcoded TRUE) ──► dashboard.tsx
                     also writes plan_type='Pro' to gym_settings (now blocked by trigger)

auth-context.tsx ─► auth-role.ts ─► (profiles, gym_profiles, members)
                 └─► consumed by EVERY route via __root.tsx <AuthRedirects/>

kioskPass.ts ─► MemberQRCard, KioskMode, MemberWallCheckIn, MemberJoinScanner

supabase.ts ─► imported by ~everything (single client singleton)
```

**The critical structural defect is the fan-in to feature gating:** four independent gating
mechanisms read overlapping-but-different maps. See §4.

---

## 3. Scores

| Dimension | Score | Reasoning |
|---|---:|---|
| Maintainability | **4/10** | 2,585-line `dashboard.tsx`; 3 gating generations; `activity_log` schema not in repo; no tests; direct DB calls scattered in components. |
| Scalability (infra) | **6/10** | Supabase/Postgres scales vertically well; good scale indexes (`20260619`); but unbounded client queries + per-page duplicate `gym_settings` fetches + no query cache cap throughput. |
| Security architecture | **7/10** | Excellent DB-side lockdowns for money/points/membership; lets down on `activity_log` (no RLS in repo), unsigned QR, client-side plan write paths still present. |
| Data consistency | **6/10** | Strong triggers for `amount_paid`, vibe_points; but denormalized counters + client `activity_log` inserts + no UTR uniqueness create drift vectors. |
| Overall architecture | **5.5/10** | Strong spine, frayed edges. The edges are exactly the user-reported bugs. |

---

## 4. Broken architecture: the THREE feature-gating generations (root of "lock icons appear incorrectly")

This is the headline architectural defect. Verified:

**Generation A — legacy `FeatureLock.tsx`** (`src/components/FeatureLock.tsx`):
- Line 33: `const isPro = true; // ...Temporarily disabled for customer demo`.
  Because every render branch keys off `!isPro`, **the lock is permanently OFF** — it
  always renders children unlocked regardless of plan.
- `finalizeUpgrade()` (lines 62–88) writes `plan_type:"Pro"` **directly from the client**
  to `gym_settings`. This path is now **blocked by `app_lock_plan_columns`**
  (`20260621_subscription_security.sql`) — so the legacy "upgrade" button is dead and will
  error if clicked. Still used in `dashboard.tsx:1734,1814,1817,1858`.

**Generation B — `permissions.ts` + `ProtectedProRoute`/`ProFeatureGuard`**:
- `ProtectedProRoute.tsx:44` gates on `subscriptionHasFeature(sub,'advanced_analytics')`.
  In the **marketing `Feature` map**, `advanced_analytics` is part of `GROWTH_FEATURES`
  (`plans.ts:71-82`) → unlocks at **Growth**. But the lock UI literally says
  **"Upgrade to Pro"** (`ProtectedProRoute.tsx:94`). Used by `RevenueView.tsx:631` and
  `InventoryManager.tsx:639`. → A Growth user is correctly unlocked, but every label,
  modal, and CTA mislabels it as a "Pro" feature.

**Generation C — `plans.ts` `AppFeature` + `usePlanAccess`/`FeatureRouteGuard`** (the intended SSOT):
- `dashboard.tsx:2071-2073` and `2147-2149` compute nav access with **two different
  helpers in the same map loop**: `planAllows(gymSettings, appFeature)` *or*
  `subscriptionHasFeature(gymSettings, item.feature)` depending on whether a nav item
  carries an `appFeature`.

**The enum collision (most insidious):** the string `"advanced_analytics"` exists in
**both** type maps with **different tiers**:
- `Feature` map: `advanced_analytics` ∈ `GROWTH_FEATURES` → **Growth** (`plans.ts:72`).
- `AppFeature` map: `FEATURE_MIN_TIER.advanced_analytics = "pro"` (`plans.ts:350`).

So the *same feature name* resolves to **Growth via `subscriptionHasFeature` but Pro via
`planAllows`**. Whether a surface shows a lock depends entirely on which helper it happens
to call. This is a textbook example of why the prompt's `hasFeature(feature)` mandate
exists — and it is currently violated.

**Consequence matrix (verified by tracing):**

| Surface | Helper used | Map | Effective tier for "analytics/inventory" |
|---|---|---|---|
| Owner nav (sidebar) | `planAllows` / `subscriptionHasFeature` (mixed) | both | inconsistent per item |
| Revenue page | `ProtectedProRoute`→`subscriptionHasFeature('advanced_analytics')` | Feature | **Growth**, labeled "Pro" |
| Inventory page | `ProtectedProRoute`→`subscriptionHasFeature('advanced_analytics')` | Feature | **Growth**, labeled "Pro" |
| AI/WhatsApp tiles | `<FeatureLock>` (`isPro=true`) | none | **always unlocked** |
| City leaderboard | `FeatureRouteGuard('leaderboard')` | AppFeature | **Growth** (correct) |
| Settings reminders | `subscriptionHasFeature('auto_reminders')` | Feature | Growth (correct) |

**Required architecture (matches the prompt):** one function — `hasFeature(feature)` — over
one feature enum and one tier map, consumed identically by nav, pages, route guards, and
mirrored on the server. Delete Generations A and B; collapse `Feature` and `AppFeature`
into a single map; make `usePlanAccess().hasAccess` the only client entry point.

---

## 5. Ranked technical debt

| # | Debt | Evidence | Impact |
|---|---|---|---|
| 1 | 3 feature-gating generations + enum collision | §4 | Wrong locks; unsellable upsells; user-reported bug |
| 2 | `activity_log` table has **no committed DDL/RLS** | not found in `supabase/migrations/**`; used in `dashboard.tsx:478`, RPCs, scale scripts | Mark-all-read no-op; possible cross-tenant read; un-reproducible env |
| 3 | `dashboard.tsx` is 2,585 lines, mixes nav/data/gating/modals | `src/routes/dashboard.tsx` | Change risk, merge conflicts, untestable |
| 4 | Dead/duplicate payment SDKs (Stripe x2, Razorpay, PhonePe) vs only-mock-UPI wired | `package.json`; `FeatureLock.tsx`, `phonepe.ts`, `StripeProvider.tsx` | Bundle bloat, security surface, confusion |
| 5 | No TanStack Query usage despite dep; direct `useEffect` fetching everywhere | `dashboard.tsx`, `member-dashboard.tsx` | No cache/dedup/retry; duplicate `gym_settings` fetches |
| 6 | `@supabase/supabase-js` mis-placed in `devDependencies` | `package.json` | Breaks `--production` installs |
| 7 | Client-side `activity_log` insert in kiosk | `KioskMode.tsx:249` | Forgeable feed rows; should be RPC/trigger |
| 8 | Unbounded `gym_plans` select then client-filter by owner | `dashboard.tsx:538` | Defense-in-depth violation; perf |
| 9 | `20260616_checkin_radius_per_gym.sql` is an **empty file** | file present, 0 SQL | Per-gym radius advertised but unimplemented |
| 10 | No automated tests / no `test` script | `package.json` | Every change unguarded |

---

## 6. Behavior at scale (per-tenant model: 1 gym = 1 owner row + N member rows)

| Scale | Gyms | Members (≈) | Expected behavior | Limiting factor |
|---|---|---|---|---|
| Now | 10 | ~2–5k | Fine | none material |
| 100 | 100 | ~50k | Fine with `20260619` indexes | duplicate `gym_settings` fetches add latency |
| 1,000 | 1,000 | ~500k | Mostly fine | unbounded member/plan queries on big gyms; Realtime fan-out; no query cache |
| 10,000 | 10,000 | ~5M | **Strained** | Realtime connection limits; `activity_log` unbounded growth (no partition/retention); leaderboard aggregation cost; single Supabase project hot rows |

See `PERFORMANCE_AUDIT_REPORT.md` for the migration plan per tier.

---

## 7. State management

- **Auth/session/role**: centralized and correct (`auth-context.tsx`) with a monotonic
  `applyToken` to prevent stale-role overwrite (`auth-context.tsx:62-92`). Good.
- **Plan/subscription**: re-derived per component via `usePlanAccess()` or ad-hoc fetches.
  No shared cache → N fetches of the same `gym_settings` row per page. Should be a single
  context/provider (mirror the auth pattern).
- **Notifications**: local component state with optimistic writes that can desync from DB
  (the mark-all-read bug). No cross-tab/cross-session reconciliation beyond a refetch.
