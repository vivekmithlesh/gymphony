# Gymphony — Production Readiness Scorecard

> Read-only. 0–10 per dimension with reasoning. Target: scale to thousands of paying gyms.

---

## Scorecard

| Dimension | Score | Reasoning |
|---|---:|---|
| **Architecture** | 5.5/10 | Strong Postgres-as-backend spine; let down by 3 competing gating generations and a core table (`activity_log`) absent from version control. |
| **Security** | 6.5/10 | Excellent money/points/membership lockdowns at DB layer; gaps in `activity_log` RLS, unsigned QR, prod mock-pay hatch, leftover client privilege writes. |
| **Performance** | 6/10 | Good scale indexes; hurt by unbounded queries, duplicate `gym_settings` fetches, no query cache, no `activity_log` retention. |
| **Reliability** | 4.5/10 | No automated tests; no monitoring/alerting beyond `console.*`; cleanup sweeps are owner-triggered, not scheduled; optimistic UI can desync from DB. |
| **Maintainability** | 4/10 | 2,585-line dashboard; mixed gating styles; schema drift; dead payment SDKs. |
| **Scalability** | 6/10 | Will reach ~1,000 gyms with the quick wins; 10,000 needs realtime/cron/replica work. |
| **Testing** | 1.5/10 | No test runner, no `test` script, no unit/integration/e2e suite (only a hand-written scenario list in `kioskPass.e2e.ts`). |
| **Developer Experience** | 6/10 | Clean TanStack/Tailwind/Radix setup; `tsc` passes; good migration discipline for security — but no tests and schema-in-repo gap erode confidence. |
| **Overall** | **5/10** | Solid foundation, production-real money/identity controls, but correctness/consistency edges (the user-reported bugs) and zero test coverage block confident scaling. |

---

## Go / No-Go for scaling to thousands of gyms

**Conditional GO**, contingent on the Immediate items in `EXECUTION_ROADMAP.md`:

**Blockers (must fix before aggressive growth):**
1. Commit `activity_log` DDL + RLS (fixes mark-all-read; closes tenant-isolation unknown).
2. Unify feature gating behind one `hasFeature()` over one map (fixes wrong locks; makes
   upsells sellable).
3. Remove/guard `app_simulate_online_payment` in production (closes self-activation hatch).
4. Add a UTR uniqueness constraint + payment audit trail.
5. Stand up a test runner (Vitest) with coverage of auth, gating, payments, QR, notifications.

**Strongly recommended before 1,000 gyms:**
6. Sign QR payloads + NOT NULL `members.gym_owner_id`.
7. SubscriptionProvider to remove duplicate fetches; bound all list queries.
8. Add missing indexes; move cleanup sweeps to `pg_cron`.
9. Error tracking + structured logging + uptime/alerting.

**Confidence:** the hard part (trustworthy money/identity/points in Postgres) is **already
done well**. The remaining work is consolidation, schema hygiene, and test coverage — all
tractable.

---

## Verification snapshot (Phase 9)

- `npx tsc --noEmit` → **PASS (exit 0)**.
- `npx eslint .` → **did not complete** in the audit window (no output before timeout); re-run locally.
- `vite build` → not executed in this read-only pass.
- Tests → **none exist**.
