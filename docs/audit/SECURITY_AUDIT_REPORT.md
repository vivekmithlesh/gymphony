# Gymphony — Security Audit Report (OWASP-oriented)

> Read-only. Evidence only — no speculation. Each finding cites file/line.
> Severity: P0 (critical) · P1 (high) · P2 (medium) · P3 (low).

---

## Executive verdict

The **money/identity/points core is well-defended** at the database layer: members cannot
self-activate membership or subscriptions, cannot forge points, and cannot write protected
columns. The exploitable surface is concentrated in **(a) a notifications table with no
committed RLS, (b) unsigned QR payloads, (c) leftover client-side privilege-write code,
and (d) a production "mock payment" escape hatch.**

---

## S-1 · `activity_log` has no committed schema or RLS — P1 (tenant isolation + integrity)

**OWASP:** A01 Broken Access Control / A05 Security Misconfiguration.

**Evidence:** No `CREATE TABLE ... activity_log` or any `activity_log` RLS policy exists in
`supabase/migrations/**` (verified by full-text search). Yet it is read with a tenant
filter in `src/routes/dashboard.tsx:478` (`.eq('gym_owner_id', currentUserId)`) and
`src/member-dashboard.tsx:182` (`.eq('member_id', memberId)`), written by SECURITY DEFINER
RPCs (`20260603_process_wall_checkin.sql:115`, `20260604`, `20260605`, `20260607`, `20260608`),
**and written directly from the browser** in `src/components/KioskMode.tsx:249`.

**Why it matters two ways:**
1. If the live table has **RLS disabled**, any authenticated user can `select * from
   activity_log` and read **every gym's** feed (cross-tenant PII leak: member names, payment
   notes, purchase descriptions).
2. If RLS is **enabled with only a SELECT policy** (the most likely real state, since reads
   are tenant-scoped and work), then the "mark all as read" `UPDATE` matches 0 rows and the
   client write silently no-ops (Finding S-2).

Either way the table's authorization is **unknown from the codebase**, which for a
multi-tenant SaaS is unacceptable.

**Fix:** Capture the live DDL into a migration and define explicit RLS:
`ENABLE ROW LEVEL SECURITY`; SELECT/UPDATE for owners `using (gym_owner_id = auth.uid())`,
SELECT/UPDATE for members `using (member_id = auth.uid())`; **no client INSERT** (inserts
via SECURITY DEFINER RPC only). Add a retention/partition policy (see Performance).

---

## S-2 · "Mark all as read" silently fails — P2 (integrity / UX, same root as S-1)

**Evidence:** `src/routes/dashboard.tsx:506-523` and `src/member-dashboard.tsx:196-208`
issue `update({is_read:true})` then optimistically `setUnreadCount(0)` + success toast.
The owner handler even has `if (error) throw error` — but a missing UPDATE RLS policy
returns **0 rows affected with NO error**, so the catch never fires, the toast lies, and a
refresh restores the badge via `fetchNotifications`. The client code is correct; the DB
authorization is the defect (depends on S-1).

**Fix:** the RLS UPDATE policy from S-1, plus switch to a `mark_notifications_read()` RPC
that returns the affected count so the client can react truthfully.

---

## S-3 · QR payloads are unsigned plaintext JSON — P2 (forgery / spoofing)

**OWASP:** A08 Software & Data Integrity Failures.

**Evidence:** `src/lib/kioskPass.ts:23-26` builds the member pass as
`{"member_id":...,"gym_id":...}` with no signature/nonce/expiry; `parseMemberPass`
(`kioskPass.ts:34-51`) accepts any well-formed JSON. Wall/join payloads are likewise plain.

**Residual risk (mitigations that exist):** server still enforces the real boundary —
`evaluateMember` checks `gym_owner_id` (`kioskPass.ts:137-162`), and `process_wall_checkin`
enforces a 100 m geo-fence + 4-hour de-dup (`20260603_process_wall_checkin.sql:38,88-100`).
So a forged pass cannot check in at a *different* gym or beyond the fence. **But:** any
member's `member_id`+`gym_id` (both visible in their own QR / network traffic) can be
re-encoded to **mark another member present** at the correct gym, and there is no expiry,
so a screenshot of a pass is valid forever.

**Critical sub-case — orphan members bypass the cross-gym guard:** if `members.gym_owner_id`
is NULL, the guard has no key to reject on and the pass is accepted at **any** gym. This is
explicitly documented in the test scenarios (`src/lib/kioskPass.e2e.ts:99-107`).

**Fix:** sign payloads (HMAC-SHA256 over `{member_id,gym_id,iat,exp}` with a server secret;
`crypto-js` is already a dependency) with a short TTL for check-in passes; validate the
signature + expiry server-side in the RPC. Backfill/NOT NULL `members.gym_owner_id`.

---

## S-4 · Production "mock payment" self-activation escape hatch — P1 (broken access control)

**OWASP:** A01 / A04 Insecure Design.

**Evidence:** `app_simulate_online_payment` (`20260617_self_serve_join.sql`) lets a member
activate their **own** `pending_verification` payment **without owner approval**, gated only
by the `gym_settings.allow_mock_payments` boolean. If that flag is ever `true` in
production, the entire manual-verification control (S-7) is bypassed and members
self-activate memberships for free.

**Fix:** remove `app_simulate_online_payment` from the production migration set (move to a
seed/dev-only file), or hard-require a non-production guard. Add a monitoring assertion that
`allow_mock_payments = false` for all live gyms.

---

## S-5 · Leftover client-side privilege writes — P2 (defense-in-depth / dead-but-dangerous)

**Evidence:**
- `FeatureLock.tsx:62-88` `finalizeUpgrade()` writes `plan_type:"Pro"` + `plan_status:"Active"`
  + 30-day expiry straight from the browser to `gym_settings`. This is **now blocked** by
  `app_lock_plan_columns` (`20260621`) — good — but the code still ships and will throw a
  confusing error if a user reaches it. It also encodes the *old* `plan_type` column model.
- The Stripe/PhonePe "finalize upgrade" paths (`StripeProvider.tsx`, `phonepe.ts`) follow the
  same pattern and are not wired to verified webhooks.

**Fix:** delete these client write paths. Plan changes must flow only through
`app_set_owner_plan` (service_role, webhook-verified — `20260621_subscription_security.sql`).

---

## S-6 · Client-side authorization filtering on `gym_plans` — P2 (IDOR-shaped)

**Evidence:** `src/routes/dashboard.tsx:538-541` runs `.from("gym_plans").select("*")`
with **no `gym_owner_id` filter**, then filters in JS at `dashboard.tsx:589-591`. If RLS on
`gym_plans` is weak/absent, an owner can read every gym's plan/pricing config by patching
the client. Client-side filtering is not a security boundary.

**Fix:** add `.eq("gym_owner_id", currentUserId)` server-side; confirm `gym_plans` RLS.

---

## S-7 · Manual UPI verification — strengths and the missing UTR uniqueness — P2

**Strengths (verified):** members can only INSERT `status='pending_verification'`
(`20260606_payments_rls.sql`); `approve_payment` is owner-authorized + atomic + calls the
single privileged writer `app_activate_member` (`20260607`); `amount_paid` is kept in sync
by a trigger (`20260612`). Self-activation is genuinely prevented.

**Gap:** there is **no UNIQUE constraint on the UTR / payment reference** in the `payments`
table (verified — no such constraint in `20260605`/`20260606`). The same UTR can be
submitted on multiple pending rows, enabling duplicate-claim/replay against a manual
reviewer and double-counting in `amount_paid` if both are approved.

**Fix:** add `UNIQUE` on the UTR column (partial unique where UTR is not null), and reject
re-use across gyms. Add an evidence-upload column + immutable audit trail (see Roadmap).

---

## S-8 · Member auth = silent signup (enumeration / bot account creation) — P3

**Evidence:** `src/routes/member-login.tsx:126-169` — a failed login auto-creates an
account. This is intentional UX but enables account enumeration and unthrottled account
creation by bots; combined with `ensureMemberProfile()` client-side row creation
(`member-login.tsx:63`) it also creates a race on concurrent first logins.

**Fix:** move provisioning to an idempotent SECURITY DEFINER RPC; add rate limiting / CAPTCHA
on member auth.

---

## S-9 · `profiles` base table has no RLS (view-only protection) — P2

**Evidence:** the app reads/writes through the `members` view; the underlying `profiles`
table relies on the column-lockdown trigger (`20260607`) + view RLS rather than its own
RLS. Membership columns are protected, but **non-locked columns** on `profiles` may be
updatable cross-tenant if reached directly. Confirm and add table-level RLS as belt-and-braces.

---

## OWASP coverage summary

| OWASP 2021 | Status | Notes |
|---|---|---|
| A01 Broken Access Control | ⚠️ | S-1, S-4, S-6, S-9. Core money paths good; edges leak. |
| A02 Cryptographic Failures | ⚠️ | S-3 unsigned QR. No other secrets in client verified. |
| A03 Injection | ✅ | Parameterized via supabase-js/PostgREST; RPCs use args, not string SQL. |
| A04 Insecure Design | ⚠️ | S-4 mock-payment hatch; S-8 silent signup. |
| A05 Security Misconfiguration | ⚠️ | S-1 uncommitted schema; payment SDK sprawl. |
| A07 Auth Failures | ✅/⚠️ | Strong central auth; S-8 enumeration. |
| A08 Data Integrity Failures | ⚠️ | S-3 QR, S-7 UTR, client `activity_log` insert (S-1). |
| A09 Logging/Monitoring | ❌ | No scan audit log, no payment audit log, `console.*` only. |

**Top 3 security priorities:** S-1 (`activity_log` RLS in repo) → S-4 (kill prod mock-pay) →
S-3 (sign QR + NOT NULL `gym_owner_id`).
