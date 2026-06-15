# Gymphony — Top 25 Findings (ranked)

> Severity: P0 (ship-blocker / active data risk) · P1 (high) · P2 (medium) · P3 (low).
> Every finding is verified against code with file:line.

---

### 1. Feature gating fragmented across 3 generations + enum collision — **P0**
- **Business impact:** Users see locks on features they paid for and see paid features unlocked; upsell CTAs mislabel tiers ("Pro" vs "Growth"). Directly the reported "lock icons appear incorrectly."
- **Technical impact:** `"advanced_analytics"` = Growth in the `Feature` map (`plans.ts:72`) but Pro in the `AppFeature` map (`plans.ts:350`); gating result depends on which helper a surface calls.
- **Root cause:** `FeatureLock` (`isPro=true`, `FeatureLock.tsx:33`), `permissions.ts`/`ProtectedProRoute` (`subscriptionHasFeature`), and `plans.ts`/`usePlanAccess` (`planAllows`) coexist.
- **Affected files:** `src/lib/plans.ts`, `src/lib/permissions.ts`, `src/lib/usePlanAccess.ts`, `src/components/FeatureLock.tsx`, `ProtectedProRoute.tsx`, `ProFeatureGuard.tsx`, `FeatureRouteGuard.tsx`, `src/routes/dashboard.tsx:2071-2073,2147-2149`, `RevenueView.tsx:631`, `InventoryManager.tsx:639`.
- **Affected functions:** `subscriptionHasFeature`, `planAllows`, `tierHasFeature`, `tierUnlocks`.
- **Fix:** One `hasFeature(feature)` over one merged map; delete `FeatureLock`/`ProtectedProRoute`/`ProFeatureGuard`; route every surface through `usePlanAccess().hasAccess`.
- **Effort:** M (1–2 wk). **Risk if ignored:** Lost revenue, churn, support load; unsellable Pro.

### 2. `activity_log` has no committed schema/RLS → "Mark all as read" no-ops — **P0**
- **Business impact:** Notifications never clear; possible cross-tenant feed leak.
- **Technical impact:** Client `update({is_read:true})` matches 0 rows w/o error; optimistic UI lies.
- **Root cause:** Table created out-of-band; no DDL/RLS in `supabase/migrations/**`.
- **Affected files:** `src/routes/dashboard.tsx:506-523`, `src/member-dashboard.tsx:196-208`, all RPCs inserting to it, `scripts/scale-test/*`.
- **Fix:** Commit DDL; `ENABLE RLS`; owner/member SELECT+UPDATE policies; `mark_notifications_read()` RPC returning affected count.
- **Effort:** S–M. **Risk if ignored:** Broken UX + potential PII exposure.

### 3. Production "mock payment" self-activation hatch — **P1**
- **Business impact:** Members could activate memberships free if a flag flips.
- **Root cause:** `app_simulate_online_payment` gated only by `allow_mock_payments` (`20260617`).
- **Affected files:** `supabase/migrations/20260617_self_serve_join.sql`, `MemberUpiCheckout.tsx`.
- **Fix:** Remove from prod migrations / hard non-prod guard; assert flag false for live gyms.
- **Effort:** S. **Risk if ignored:** Revenue loss / fraud.

### 4. Unsigned, non-expiring QR payloads + orphan-member bypass — **P1**
- **Business impact:** Forged attendance; a member can mark another present; passes valid forever.
- **Root cause:** Plaintext JSON (`kioskPass.ts:23-26`); guard relies on `gym_owner_id` which can be NULL (`kioskPass.e2e.ts:99-107`).
- **Fix:** HMAC-sign `{member_id,gym_id,iat,exp}` (crypto-js present); verify in RPC; NOT NULL `members.gym_owner_id` + backfill.
- **Effort:** M. **Risk if ignored:** Attendance fraud, integrity loss.

### 5. No automated tests / no test runner — **P1**
- **Technical impact:** Every refactor (including #1) is unguarded.
- **Root cause:** No `test` script; only `kioskPass.e2e.ts` scenario list.
- **Fix:** Vitest + React Testing Library; cover plans/gating, payments RPC contracts, QR parse/sign, notification RPC, auth role resolution.
- **Effort:** M–L. **Risk if ignored:** Regressions ship silently.

### 6. No UNIQUE on payment UTR — **P2**
- **Root cause:** `payments` lacks UTR uniqueness (`20260605`/`20260606`).
- **Fix:** Partial UNIQUE on UTR; reject cross-gym reuse; evidence upload + audit trail.
- **Effort:** S. **Risk:** Duplicate/replay claims; `amount_paid` double counting.

### 7. Client-side `activity_log` insert in kiosk — **P2**
- **Root cause:** `KioskMode.tsx:249` inserts feed rows from browser.
- **Fix:** Move to trigger on `check_ins` INSERT or SECURITY DEFINER RPC.
- **Effort:** S. **Risk:** Forgeable/spam feed rows.

### 8. Unbounded `gym_plans` query + client-side authz filter — **P2**
- **Root cause:** `dashboard.tsx:538` `select('*')` no owner filter; JS filter at `:589`.
- **Fix:** Server filter `.eq('gym_owner_id', userId)`; confirm RLS.
- **Effort:** S. **Risk:** IDOR if RLS weak; perf.

### 9. Leftover client privilege-write paths (FeatureLock/Stripe/PhonePe) — **P2**
- **Root cause:** `FeatureLock.finalizeUpgrade` writes `plan_type:'Pro'` (`FeatureLock.tsx:62-88`); now blocked by `app_lock_plan_columns` but still shipped.
- **Fix:** Delete; plan changes only via `app_set_owner_plan` (service_role).
- **Effort:** S. **Risk:** Confusing errors; dead code rot.

### 10. Duplicate `gym_settings` fetches per page; no query cache — **P2**
- **Root cause:** `usePlanAccess.ts:44` + `ProtectedProRoute.tsx:31` + dashboard fetch; no TanStack Query.
- **Fix:** Single `SubscriptionProvider`.
- **Effort:** M. **Risk:** Latency, re-render churn, scale cost.

### 11. `dashboard.tsx` is 2,585 lines — **P2**
- **Fix:** Split into nav, notifications, plans, revenue, inventory, AI modules.
- **Effort:** M. **Risk:** Change risk, untestable.

### 12. Missing index `profiles(gym_id, expiry_date)` — **P2**
- **Root cause:** `expire_overdue_members` (`20260611`) scans.
- **Fix:** Add index. **Effort:** S.

### 13. Missing index `workout_logs(gym_id, created_at)` — **P2**
- **Root cause:** leaderboard aggregation (`20260623`). **Fix:** Add index. **Effort:** S.

### 14. `activity_log` has no retention/partitioning — **P2**
- **Fix:** Monthly partitions + 90-day retention + member-id index. **Effort:** M.

### 15. Cleanup sweeps are owner-triggered, not scheduled — **P2**
- **Root cause:** `expire_overdue_members`, `expire_stale_store_purchases` run only on UI call.
- **Fix:** `pg_cron`. **Effort:** S.

### 16. Member auth = silent signup (enumeration / bot accounts) — **P3**
- **Root cause:** `member-login.tsx:126-169` + client `ensureMemberProfile` (`:63`).
- **Fix:** Idempotent provisioning RPC; rate limit/CAPTCHA. **Effort:** M.

### 17. `@supabase/supabase-js` in `devDependencies` — **P3**
- **Fix:** Move to `dependencies`. **Effort:** XS. **Risk:** `--production` install breaks.

### 18. Three payment SDKs shipped, only mock-UPI wired — **P3**
- **Fix:** Remove unused Stripe/Razorpay/PhonePe until a gateway is chosen. **Effort:** S.

### 19. `20260616_checkin_radius_per_gym.sql` is an empty file — **P3**
- **Fix:** Implement per-gym radius from `gym_settings`, or remove the file + advertise 100 m fixed. **Effort:** S.

### 20. No scan/payment audit log (observability) — **P2**
- **Fix:** `scan_log` + immutable `payment_events`; needed for fraud forensics + dispute resolution. **Effort:** M.

### 21. `check_ins.gym_id` FK is NOT VALID — **P3**
- **Root cause:** `20260602_check_ins_gym_id.sql:54-57`. **Fix:** Clean data then `VALIDATE CONSTRAINT`. **Effort:** S.

### 22. `process_wall_checkin` de-dup not lock-protected — **P3**
- **Root cause:** `SELECT EXISTS` + INSERT race (`20260603:88-100`). **Fix:** partial unique/advisory lock. **Effort:** S.

### 23. `profiles` base table lacks table-level RLS — **P2**
- **Root cause:** view + trigger protection only. **Fix:** add table RLS belt-and-braces. **Effort:** S.

### 24. No error tracking / structured logging / alerting — **P2**
- **Root cause:** `console.warn/error` only across dashboard/member dashboard. **Fix:** Sentry + structured logs + uptime alerts. **Effort:** M.

### 25. Optimistic UI desync beyond notifications — **P3**
- **Root cause:** several handlers set local state before/without confirming DB (pattern around `dashboard.tsx:517`, member-dashboard). **Fix:** confirm-then-set or reconcile via refetch. **Effort:** S–M.

---

## The 5 highest-priority (do first)
1. **#2** Commit `activity_log` DDL+RLS → fixes Mark-all-read + closes tenant unknown.
2. **#1** Unify feature gating behind one `hasFeature()` → fixes wrong locks + sellable tiers.
3. **#3** Kill prod mock-payment hatch → closes self-activation.
4. **#4** Sign QR + NOT NULL `gym_owner_id` → stops attendance forgery.
5. **#5** Stand up Vitest → make every subsequent fix safe.
