# Gymphony — Database Audit Report

> Read-only. Source: `supabase/migrations/20260516 → 20260623` (41 migrations).
> Cross-gym isolation in this app is **app-level via `gym_owner_id`** plus RLS on most
> tables — verified below.

---

## 1. Table inventory (key columns · FKs · RLS)

| Table | Purpose | Key cols | FKs | RLS |
|---|---|---|---|---|
| `profiles` (base) | user/member record | id, gym_id, gym_owner_id, status, membership_plan, subscription_*, expiry_date, amount_paid | — | **No table RLS**; protected by `app_lock_membership_columns` trigger (`20260607`/`20260613`) + `members` view RLS |
| `members` (view over profiles) | app-facing member API | — | — | RLS on view |
| `gym_settings` | the gym + owner subscription | gym_owner_id, gym_name, upi_id, latitude/longitude, plan_tier, plan_status, trial_ends_at, expiry_date, billing_cycle, allow_mock_payments | — | ENABLED; plan cols locked by `app_lock_plan_columns` (`20260621`) |
| `gym_profiles` | legacy owner/points row | id, role, vibe_points | — | `vibe_points` guarded by `guard_vibe_points` trigger (`20260615`) |
| `membership_plans` / `gym_plans` | per-gym plan catalog | gym_id, gym_owner_id, name, plan_name, price, duration | gym_settings, profiles (CASCADE) | ENABLED |
| `check_ins` | attendance | member_id, gym_id, status, check_in_time | gym_settings (**FK NOT VALID**, `20260602:54`) | ENABLED |
| `payments` | member dues / UPI | member_id, gym_id, gym_owner_id, plan_name, amount, status, payment_method | auth.users (implicit) | ENABLED; INSERT limited to `pending_verification` self (`20260606`) |
| `purchases` | store orders | member_id, product_id, gym_id, gym_owner_id, qty, prices, status, campaign_id | inventory (SET NULL) | ENABLED; **no INSERT policy** (RPC only) |
| `inventory` | store items | gym_owner_id, item_name, price, stock_quantity, show_in_app, gym_id | auth.users (CASCADE) | ENABLED (+ member SELECT of `show_in_app`) |
| `campaigns` | discounts | gym_owner_id, discount_percentage, target_type, is_active, ends_at | auth.users (CASCADE) | ENABLED (+ member SELECT of active) |
| `conversations` / `messages` | member↔owner chat | gym_id, gym_owner_id, sender, content | gym_settings/conversations (CASCADE) | ENABLED |
| `member_goals` / `member_goal_completions` | goals | member_id, goal_id, completed_on | member_goals (CASCADE) | ENABLED (own only); `UNIQUE(goal_id,completed_on)` |
| `workout_sessions` | finished workouts | member_id, gym_id, session_date, workout_count, total_calories | — | ENABLED; `UNIQUE(member_id,session_date)`; INSERT revoked (RPC only) |
| `member_notes` | per-day notes | member_id, note_date | — | ENABLED (own only); `UNIQUE(member_id,note_date)` |
| `reviews` | gym reviews | member_id, gym_id | — | ENABLED |
| **`activity_log`** | **notifications / feed** | gym_owner_id, member_id, activity_type, description, is_read, created_at | — | **NO COMMITTED DDL OR RLS — NOT FOUND IN REPOSITORY** |

> The `activity_log` gap is the single most important DB finding — see
> `SECURITY_AUDIT_REPORT.md` S-1/S-2.

---

## 2. RLS posture (verified)

- **Tenant-scoped & enforced:** `check_ins`, `payments`, `purchases`, `inventory`,
  `campaigns`, `messages`, `conversations`, member-owned tables (`member_goals`,
  `member_notes`, `workout_sessions` SELECT), `reviews`.
- **Trigger-enforced (not RLS):** `profiles` membership columns (`app_lock_membership_columns`,
  `20260607`/`20260613`); `gym_settings` plan columns (`app_lock_plan_columns`, `20260621`);
  `gym_profiles.vibe_points` (`guard_vibe_points`, `20260615`).
- **Member cross-member visibility** (leaderboard) uses a SECURITY DEFINER helper
  `current_member_gym_id()` to avoid RLS recursion (`20260602`).
- **Unknown / missing:** `activity_log` (S-1); confirm `gym_plans`/`gym_settings` SELECT
  scoping given the unbounded client query in `dashboard.tsx:538`.

---

## 3. RPC inventory (SECURITY DEFINER unless noted) — authorization check per RPC

| RPC | AuthZ check | Notes |
|---|---|---|
| `process_wall_checkin` | `auth.uid() = p_member_id` | geo-fence 100 m + 4 h de-dup (`20260603`) |
| `log_workout_session` | `auth.uid() = p_member_id` + checked-in-today | server-side calories; 1/day unique (`20260615`) |
| `approve_payment` / `reject_payment` | `gym_owner_id = auth.uid()` | atomic flip + `app_activate_member` (`20260605`/`20260607`) |
| `app_activate_member` | **not granted to any role** | sole privileged membership writer (`20260607`) |
| `initiate/approve/reject/cancel_store_purchase` | member-self / owner | stock lock + reserve (`20260608`/`20260609`) |
| `app_set_owner_plan` | **service_role only** | webhook-verified plan writes (`20260621`) |
| `app_start_owner_trial` | `auth.uid()` | one-time trial (`20260621`) |
| `ensure_gym_settings` | `auth.uid() = gym_owner` | idempotent provisioning + unique gym_id (`20260621`) |
| `can_add_member` / `fn_enforce_member_limit` | owner-scoped | plan member cap (`20260620`/`20260621`) |
| `get_city_gym_leaderboard` | **Growth tier required** → raises `42501` | server-side feature gate (`20260623`) |
| `get_gym_today_stats` | public aggregates only | no PII (`20260613`) |
| `expire_overdue_members` / `expire_stale_store_purchases` | owner-scoped / system | **owner-triggered, not cron** |
| `app_simulate_online_payment` | member-self + `allow_mock_payments` | **DANGEROUS in prod — S-4** (`20260617`) |

This RPC design is the **strong part** of the system: every privileged mutation is a
SECURITY DEFINER function with an explicit `auth.uid()`/role check and the lockdown
triggers ensure no other write path exists.

---

## 4. Triggers

`trg_lock_membership_cols` (profiles), `trg_lock_plan_columns` (gym_settings),
`trg_guard_vibe_points` (gym_profiles), `trg_enforce_member_limit` (profiles BEFORE INSERT),
`trg_fill_payment_owner` (payments — auto-fills owner/gym), `trg_payments_resync_amount_paid`
(payments → profiles.amount_paid), `trg_start_trial_on_gym_insert` (gym_settings), messages
normalization triggers (`20260602`). All verified present.

---

## 5. Indexes (`20260619_scale_indexes.sql` + per-migration)

Scale pack: `payments(gym_owner_id,created_at desc)`, `payments(member_id)`,
`profiles(gym_id)`, `check_ins(gym_id,check_in_time desc)`,
`activity_log(gym_owner_id,created_at desc)` *(index references a table whose DDL is not in
the repo — S-1)*, `gym_settings(gym_owner_id)`. Plus per-table indexes for messages,
campaigns, inventory, purchases, goals, workout_sessions.

**Missing indexes (verified gaps):**
1. `profiles(gym_id, expiry_date)` — `expire_overdue_members` filters `expiry_date < now()`
   (`20260611`). No supporting index.
2. `workout_logs(gym_id, created_at)` — `get_city_gym_leaderboard` aggregates monthly by gym.
3. `payments(utr)` unique — see #6.
4. `activity_log(member_id, created_at desc)` — member dashboard reads by `member_id`
   (`member-dashboard.tsx:182`) but the only documented index is on `gym_owner_id`.

---

## 6. Missing constraints / integrity risks

| Risk | Evidence | Severity |
|---|---|---|
| No UNIQUE on `payments` UTR | not present in `20260605`/`20260606` | P2 — duplicate/replay claims (S-7) |
| `activity_log` DDL/RLS absent | not in repo | P1 — S-1/S-2 |
| `check_ins.gym_id` FK is **NOT VALID** | `20260602_check_ins_gym_id.sql:54-57` | P3 — orphan rows possible |
| `members.gym_owner_id` nullable | `kioskPass.e2e.ts:99-107` documents orphan bypass | P2 — cross-gym check-in (S-3) |
| Denormalized `amount_paid` depends on trigger firing | `20260612` | P3 — drift if trigger disabled; add periodic reconcile |
| `campaigns` no uniqueness | `20260603` | P3 — duplicate campaigns (UX) |

---

## 7. Concurrency / race review

- **`process_wall_checkin` de-dup** uses `SELECT EXISTS` then INSERT without locking the
  member/gym pair (`20260603:88-100`) — two concurrent scans could both pass. Low real-world
  probability; recommend a partial unique index `(member_id, date_trunc('hour'...))` or an
  advisory lock for correctness at scale.
- **`workout_sessions`** is race-safe via `UNIQUE(member_id, session_date)` (`20260615`).
- **`expire_stale_store_purchases`** is race-safe via single-CTE update (`20260610`).
- **Store stock** decremented under row lock in `initiate_store_purchase` (`20260608`) —
  good, prevents oversell.

---

## 8. Schema-in-repo gap (process finding)

`activity_log` proves the migrations directory is **not a complete description of the live
schema** — at least one core table was created out-of-band. Before scaling, run a
schema-diff of the live DB against `migrations/**` and commit everything missing. Until then,
no environment can be reliably reproduced and RLS cannot be reviewed for completeness.
