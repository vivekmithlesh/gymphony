# Gymphony — Codebase Intelligence Report

> Read-only production audit. Date: 2026-06-15. Branch: `feature/wall-qr-checkin`.
> Every claim cites an exact file path/line. Items that could not be verified from
> code are marked **NOT VERIFIED FROM CODEBASE** or **NOT FOUND IN REPOSITORY**.

---

## 1. Executive Summary

Gymphony is a single-repo, client-heavy SaaS for gym owners ("owners") and their
members. It is a **TanStack Start (React 19) SPA/SSR app backed entirely by Supabase**
(Postgres + RLS + RPC + Realtime). There is **no custom application server** — the
browser talks directly to Postgres through the Supabase client, and all business
rules that must be trusted live in Postgres as `SECURITY DEFINER` RPCs, RLS policies,
and triggers.

The security-critical core (membership activation, payment approval, workout/points
integrity, plan-column lockdown, member-limit enforcement) has been **deliberately and
competently pushed into the database** across migrations `20260605`–`20260623`. That
work is genuinely strong (see `DATABASE_AUDIT_REPORT.md`).

The weaknesses are concentrated in three places:

1. **Feature-gating is fragmented across three generations of code** that disagree with
   each other — this is the direct cause of the "lock icons appear incorrectly" symptom.
2. **`activity_log` (the notifications/feed table) is not in version control at all** and
   has no committed RLS — this is the direct cause of "Mark All As Read fails."
3. **QR payloads are unsigned plaintext JSON** and there is no scan audit trail.

None of these are cosmetic. They are architecture/consistency defects that will get
worse, not better, as the gym count grows.

---

## 2. Tech Stack (versions from `package.json`)

| Layer | Technology | Version |
|---|---|---|
| UI runtime | React / React-DOM | `19.2.0` |
| Framework | TanStack Start | `1.167.14` |
| Router | TanStack Router | `1.168.0` |
| Data/query | TanStack React Query | `5.83.0` (**present as dep but almost unused — see below**) |
| Build | Vite | `7.3.1` |
| Server runtime | Nitro | `3.0.260610-beta` |
| Styling | Tailwind CSS | `4.2.1` |
| UI primitives | Radix UI (≈30 packages) | various 1.x–2.x |
| Backend SDK | `@supabase/supabase-js` | `2.104.0` (**devDependency — see Finding**) |
| QR generate | `qrcode.react` | `4.2.0` |
| QR scan | `html5-qrcode` | `2.3.8` |
| Crypto | `crypto-js` | `4.2.0` (used by kiosk pass) |
| Maps | `leaflet` / `react-leaflet` | `1.9.4` / `5.0.0` |
| Payments (deps present) | `@stripe/stripe-js` `9.4.0`, `@stripe/react-stripe-js` `6.3.0`, `razorpay-checkout` `1.0.4` | mixed/unused — see below |
| Forms | react-hook-form `7.71.2` + zod `3.24.2` | |
| Spreadsheet export | `xlsx` `0.18.5`, `xlsx-js-style` `1.2.0` | |

**Stack-level observations (verified):**
- `@supabase/supabase-js` is in **`devDependencies`**, not `dependencies` (`package.json`).
  It is imported at runtime in `src/supabase.ts`. This works today because the bundler
  inlines it, but it is incorrect dependency classification and is fragile for any
  consumer that installs with `--production`.
- **Three payment SDKs are present** (Stripe x2, Razorpay) plus a custom PhonePe module
  (`src/lib/phonepe.ts`) and a mock UPI flow. Only the mock UPI + manual UPI flow is
  actually wired end-to-end. This is dead-weight dependency surface (see
  `ARCHITECTURE_AUDIT_REPORT.md` → Technical Debt).
- TanStack React Query is a dependency but the app fetches via **direct `supabase.from()`
  calls inside components/`useEffect`** throughout (`src/routes/dashboard.tsx`,
  `src/member-dashboard.tsx`, etc.). There is no query cache, dedup, or retry layer.

---

## 3. Repository Structure

```
src/
  routes/            TanStack file routes (owner dashboard, member dashboard, auth, legal, kiosk)
  components/        ~90 components (feature views + Radix ui/ primitives)
  lib/               plans.ts, permissions.ts, usePlanAccess.ts, auth-context.tsx,
                     auth-role.ts, kioskPass.ts, phonepe.ts, razorpay.ts, revenue.ts, …
  hooks/             leaderboard + live-stats hooks (the few real react-query-ish hooks)
  supabase.ts        single Supabase client (singleton)
  router.tsx         router wiring
supabase/
  migrations/        41 SQL migrations 20260516 → 20260623 (the real backend)
scripts/
  scale-test/        500-member load harness (01-seed, 02-simulate-activity, 03-cleanup)
docs/
  audit/             ← this report set
```

Key size/complexity hotspots:
- `src/routes/dashboard.tsx` — **2,585 lines**. The owner dashboard is a single mega-route
  holding nav, notifications, plans, revenue, inventory, AI tabs, modals, and three
  different feature-gating call styles. This is the single most fragile file in the repo.
- `src/member-dashboard.tsx` — large member portal with inline data fetching.
- `src/components/InventoryManager.tsx` — 1,400+ lines.

---

## 4. Feature Inventory (verified entry points)

| Feature | Primary files | Backend |
|---|---|---|
| Owner auth (email/mobile) | `src/routes/login.tsx`, `signup.tsx` | Supabase Auth + `ensure_gym_settings` RPC |
| Member auth (login = signup) | `src/routes/member-login.tsx` | Supabase Auth + `ensureMemberProfile()` client fn |
| Owner dashboard | `src/routes/dashboard.tsx` | direct queries + RPCs |
| Member dashboard | `src/member-dashboard.tsx` | direct queries + RPCs |
| Members CRUD / bulk onboard | `MembersList.tsx`, `BulkOnboard.tsx` | `profiles`/`members` view, `fn_enforce_member_limit` |
| QR wall check-in | `MemberWallCheckIn.tsx`, `WallQRTab.tsx`, `GymWallQRCode.tsx` | `process_wall_checkin` RPC (geo-fenced) |
| Kiosk scan check-in | `KioskMode.tsx`, `routes/kiosk.tsx` | direct `check_ins` insert + client `activity_log` insert |
| Member pass QR | `MemberQRCard.tsx`, `src/lib/kioskPass.ts` | client-side parse + `evaluateMember` |
| Join-by-QR (self-serve) | `MemberJoinScanner.tsx`, `GymJoinQRCode.tsx` | `20260617_self_serve_join.sql` |
| Workout logging / points | member dashboard | `log_workout_session` RPC (`20260615`) |
| Store / inventory | `InventoryManager.tsx`, `MemberGymStore.tsx` | `initiate_store_purchase`/`approve_store_purchase` |
| Campaigns / discounts | `src/lib/campaign.ts` | `campaigns` table + cron auto-expire |
| Manual UPI billing (member) | `MemberUpiCheckout.tsx`, `OwnerPendingPayments.tsx` | `payments` + `approve_payment` RPC |
| SaaS subscription (owner) | `SettingsView.tsx`, `Pricing.tsx`, `plans.ts` | `gym_settings.plan_*` + `app_set_owner_plan` |
| Feature gating | `plans.ts`, `usePlanAccess.ts`, `permissions.ts`, `FeatureLock.tsx`, `FeatureRouteGuard.tsx`, `ProtectedProRoute.tsx`, `ProFeatureGuard.tsx` | `FEATURE_MIN_TIER` + leaderboard RPC gate (`20260623`) |
| Notifications / activity feed | `dashboard.tsx`, `member-dashboard.tsx` | **`activity_log` (no committed DDL/RLS)** |
| Leaderboards | `GymMemberLeaderboard.tsx`, `CityLeaderboard*.tsx`, hooks | `get_city_gym_leaderboard` (Growth-gated) |
| Public gym discovery | `CityGymExplorer.tsx`, `gym-detail.$gymId.tsx` | `get_gym_today_stats` |

---

## 5. User-Journey Maps

### 5.1 Owner onboarding / auth
`signup.tsx` → Supabase `signUp` with `user_metadata {role:"owner", gym_id:randomUUID()}`
(`src/routes/signup.tsx:261`) → upsert `profiles`/`gym_profiles` → `ensure_gym_settings()`
RPC provisions the gym row and **auto-starts a 7-day Growth trial**
(`20260620_subscription_plans.sql` trial trigger; `20260621_subscription_security.sql`
`ensure_gym_settings`). Role is resolved by `resolveUserRole()` (`src/lib/auth-role.ts`)
with a multi-source fallback chain (profiles.role → gym_profiles → members → metadata).

### 5.2 Member onboarding / auth
`member-login.tsx` is **login-or-signup combined**: a failed sign-in auto-creates the
account (`src/routes/member-login.tsx:126`), then `ensureMemberProfile()` creates the
`profiles`/`members` rows client-side (`member-login.tsx:63`). Member status starts
non-active and is gated by `MembershipGate` until a payment is approved.

### 5.3 Dashboard load (owner)
`AuthProvider` (`src/lib/auth-context.tsx`) resolves session + role once globally;
`AuthRedirects` in `src/routes/__root.tsx` routes owner↔member. `dashboard.tsx` then runs
a burst of direct queries (`gym_settings`, `gym_plans`, `activity_log`, members counts,
revenue). `usePlanAccess()` separately re-fetches `gym_settings` for nav gating — so the
same row is fetched multiple times per page (see `PERFORMANCE_AUDIT_REPORT.md`).

### 5.4 Payment (member dues → activation)
Member submits a `pending_verification` row into `payments` (RLS forbids any other
status — `20260606_payments_rls.sql`). Owner approves via `approve_payment` RPC, which
atomically flips status and calls `app_activate_member` to write the locked membership
columns (`20260607_membership_column_lockdown.sql`). **Members cannot self-activate.**

### 5.5 Notification (feed)
Server RPCs and the kiosk client insert rows into `activity_log`. Owner/member dashboards
read it filtered by `gym_owner_id`/`member_id` and subscribe via Realtime.
"Mark all as read" issues a client `UPDATE ... SET is_read=true`. **This silently no-ops**
because the table's RLS is not in version control and (per the reported symptom) lacks an
`UPDATE` policy — see `SECURITY_AUDIT_REPORT.md` Finding S-2 and `TOP_25_CRITICAL_FINDINGS.md` #2.

### 5.6 Background jobs
One `pg_cron` job: `deactivate_expired_campaigns` every 15 min
(`20260605_campaign_auto_expire_cron.sql`). Member-expiry and stale-purchase sweeps are
**owner-triggered RPCs**, not scheduled (`expire_overdue_members`, `expire_stale_store_purchases`)
— so they only run when a UI calls them (see Reliability findings).

---

## 6. Execution Checks (Phase 9 — actually run)

| Check | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | **PASS (exit 0)** — no type errors |
| Lint | `npx eslint .` | **DID NOT COMPLETE** within the audit window (no output produced before timeout) — **EXECUTION NOT AVAILABLE**. Re-run locally to obtain counts. |
| Build | `vite build` | **NOT RUN in this pass** (heavy; deferred to avoid long-running build in read-only audit) — **EXECUTION NOT AVAILABLE in report window** |
| Tests | — | **NOT FOUND IN REPOSITORY** — there is no `test` script in `package.json` and no test files/specs other than `src/lib/kioskPass.e2e.ts` (a hand-rolled scenario list, not an executable suite). |

The **absence of any automated test runner** is itself a top finding (see Production Readiness).

---

## 7. How a new senior engineer should orient

1. Treat **Postgres as the backend**. The trustworthy logic is in `supabase/migrations/**`.
   The React app is a thin client and must not be trusted for authorization.
2. The **single source of truth for plans is `src/lib/plans.ts`** — but three older
   gating layers (`permissions.ts` helpers, `FeatureLock.tsx`, `ProtectedProRoute`/`ProFeatureGuard`)
   still ship and contradict it. Consolidating these is the highest-leverage cleanup.
3. **`activity_log` has no committed schema.** Before touching notifications, capture its
   real DDL/RLS from the live DB into a migration.
4. There is **no test harness**. Any refactor is currently unguarded.
