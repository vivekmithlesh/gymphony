# Gymphony — Execution Roadmap

> Ordered strictly by business impact. Maps to `TOP_25_CRITICAL_FINDINGS.md`.
> Each item: outcome · key files · validation.

---

## Immediate (1–3 days) — correctness & active data risk

### I-1. Commit `activity_log` schema + RLS; fix "Mark all as read" (Finding #2)
- **Do:** Dump live `activity_log` DDL → new migration. `ENABLE ROW LEVEL SECURITY`.
  Policies: owners `using/with check (gym_owner_id = auth.uid())`, members
  `using/with check (member_id = auth.uid())` for SELECT+UPDATE; **no client INSERT**.
  Add `mark_notifications_read()` SECURITY DEFINER RPC returning affected count; switch
  `dashboard.tsx:506` and `member-dashboard.tsx:196` to call it.
- **Validate:** mark-all-read persists across refresh; member A cannot read gym B's feed;
  affected-count > 0 in RPC response.

### I-2. Remove prod mock-payment self-activation (Finding #3)
- **Do:** Move `app_simulate_online_payment` to a dev-only seed; assert
  `allow_mock_payments=false` for all live gyms.
- **Validate:** member cannot transition own payment to active; owner approval still works.

### I-3. Server-side filter + bound the unbounded queries (Findings #8, #6 prep)
- **Do:** `dashboard.tsx:538` add `.eq('gym_owner_id', userId)`; `:556` add `.limit()`.
- **Validate:** network shows owner-scoped rows only; large-gym load unaffected.

### I-4. Dependency hygiene (Findings #17, #18)
- **Do:** Move `@supabase/supabase-js` to `dependencies`; remove unused Stripe/Razorpay/PhonePe.
- **Validate:** `npm ci --production` resolves; `tsc` + build pass; bundle shrinks.

---

## Short term (1–2 weeks) — the user-reported gating bug, done right

### S-1. Unify feature gating behind ONE `hasFeature()` (Finding #1)
- **Do:** Merge `Feature` + `AppFeature` into a single feature enum + single
  `FEATURE_MIN_TIER` map in `plans.ts` (resolve the `advanced_analytics` Growth-vs-Pro
  collision deliberately — pick one tier per feature). Expose `hasFeature(feature)` via
  `usePlanAccess` and a one-shot `planAllows(sub, feature)`. **Delete** `FeatureLock.tsx`,
  `ProtectedProRoute.tsx`, `ProFeatureGuard.tsx`. Replace all call sites
  (`dashboard.tsx`, `RevenueView.tsx`, `InventoryManager.tsx`, `SettingsView.tsx`) with the
  single guard + a single `UpgradeModal`.
- **Validate (test matrix):** for each tier × feature, lock state matches `FEATURE_MIN_TIER`
  exactly on: sidebar (desktop+mobile), feature pages, route guards. Trial = Growth access.
  Expired = Starter. No surface shows a lock on an unlocked feature or vice-versa.

### S-2. Sign QR payloads + close orphan bypass (Finding #4)
- **Do:** HMAC-SHA256 sign `{member_id,gym_id,iat,exp}`; verify signature+expiry inside
  `process_wall_checkin`/pass evaluation; `members.gym_owner_id` NOT NULL + backfill.
- **Validate:** tampered/expired pass rejected; orphan members fail closed.

### S-3. Payment integrity: UTR uniqueness + audit trail + evidence (Findings #6, #20)
- **Do:** Partial UNIQUE on UTR; `payment_events` immutable log; evidence-image column;
  duplicate-UTR rejected at submit.
- **Validate:** duplicate UTR blocked; every status transition has an audit row.

### S-4. Stand up Vitest (Finding #5)
- **Do:** Add `vitest` + RTL; `test` script; CI gate. Seed suites for gating, payment RPC
  contracts, QR sign/parse, notification RPC, auth role resolution.
- **Validate:** `npm test` green in CI; coverage reported.

---

## Medium term (1–2 months) — scale & reliability

### M-1. `SubscriptionProvider` + bounded data layer (Findings #10, #11)
- One `gym_settings` fetch per session; split `dashboard.tsx` into modules; adopt TanStack
  Query (already a dep) for cache/dedup/retry; keyset pagination on all lists.

### M-2. Indexes + scheduled cleanup (Findings #12, #13, #15)
- Add `profiles(gym_id, expiry_date)`, `workout_logs(gym_id, created_at)`; move
  `expire_overdue_members` / `expire_stale_store_purchases` to `pg_cron`.

### M-3. `activity_log` retention/partitioning (Finding #14) + observability (#24, #20)
- Monthly partitions + 90-day retention + member-id index; Sentry + structured logs +
  uptime/alerting; `scan_log` for QR forensics.

### M-4. Move kiosk feed insert to trigger/RPC; validate `check_ins` FK (Findings #7, #21, #22)

---

## Long term (3–12 months) — 10,000-gym readiness & the requested platform features

Gate each on the architecture being consolidated first (S-1) so RBAC/branches build on one
entitlement model, not three.

1. **Real payment gateway (Phase 2/3):** Razorpay integration behind verified webhooks →
   `app_set_owner_plan` (service_role). Then enterprise/annual invoicing.
2. **RBAC + Staff Management:** roles table + `has_permission(user, action)` mirroring
   `hasFeature`; gate at RLS + UI.
3. **Multi-Branch Management:** branch entity under owner; scope `gym_id` per branch;
   requires the isolation model to be RLS-complete first.
4. **Audit Logs / Activity Feed / Payment Ledger:** generalize `payment_events` + `scan_log`
   into a tenant audit stream.
5. **QR Scan Analytics + Advanced Reporting:** materialized rollups; read replica.
6. **Feature Flags + Subscription Management Dashboard:** build on the unified entitlement
   map from S-1 (flags = same `hasFeature` plumbing).
7. **Realtime at scale:** Supavisor pooling, channel sharding, polling fallbacks; consider
   regional projects.

---

## Sequencing rationale
- **Immediate** stops active data risk (silent no-ops, self-activation, IDOR-shaped reads)
  with small, safe diffs.
- **Short term** delivers the two headline user complaints (wrong locks, unreliable QR) and
  installs the test net that makes everything after it safe.
- **Medium/Long** is pure scale + the requested feature platform — and is only safe to build
  once gating/auth/isolation are unified (don't build RBAC and multi-branch on top of three
  contradictory gating systems).
