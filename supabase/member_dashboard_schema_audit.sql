-- =============================================================================
-- MEMBER DASHBOARD — SCHEMA AUDIT  (READ-ONLY, safe to run anytime)
-- -----------------------------------------------------------------------------
-- Run this in the Supabase SQL Editor and send back the result. It reports, for
-- every table/column the member dashboard reads or writes:
--   • COLUMN     — is each expected column present?           (MISSING = create it)
--   • TABLE      — does the table exist + is RLS enabled?
--   • REALTIME   — is the table in the supabase_realtime publication?
--   • RLS_POLICY — which policies exist on the table?         (NONE = locked out)
--
-- Notes on intentional either/or pairs (only ONE side needs to exist):
--   workout_logs.user_id  OR  workout_logs.member_id
--   gym_plans.name        OR  gym_plans.plan_name
--   gym_plans.duration    OR  gym_plans.duration_days
-- =============================================================================

with
expected_cols(tbl, col) as (
  values
    -- profiles
    ('profiles','id'),('profiles','email'),('profiles','full_name'),('profiles','gym_id'),
    ('profiles','short_id'),('profiles','membership_plan'),('profiles','status'),
    ('profiles','subscription_status'),('profiles','whatsapp_number'),('profiles','mobile_number'),
    ('profiles','phone'),('profiles','avatar_url'),('profiles','subscription_end_date'),
    -- members
    ('members','id'),('members','gym_id'),('members','gym_owner_id'),('members','full_name'),
    ('members','member_name'),('members','membership_plan'),('members','email'),('members','phone'),
    ('members','status'),('members','expiry_date'),('members','joining_date'),
    -- gym_settings (member reads gym name + LOCATION from here; owner writes it)
    ('gym_settings','id'),('gym_settings','gym_name'),('gym_settings','gym_owner_id'),
    ('gym_settings','opening_time'),('gym_settings','closing_time'),('gym_settings','city'),
    ('gym_settings','address'),('gym_settings','description'),('gym_settings','latitude'),
    ('gym_settings','longitude'),('gym_settings','logo_url'),
    -- gym_profiles (explorer/leaderboard map source)
    ('gym_profiles','gym_id'),('gym_profiles','gym_name'),('gym_profiles','latitude'),
    ('gym_profiles','longitude'),('gym_profiles','city'),('gym_profiles','rating'),
    ('gym_profiles','active_members_footfall'),('gym_profiles','vibe_points'),
    -- gym_plans
    ('gym_plans','id'),('gym_plans','gym_id'),('gym_plans','name'),('gym_plans','plan_name'),
    ('gym_plans','price'),('gym_plans','duration'),('gym_plans','duration_days'),('gym_plans','features'),
    -- gym_leaderboard
    ('gym_leaderboard','gym_id'),('gym_leaderboard','rank'),('gym_leaderboard','vibe_points'),
    -- workout_logs
    ('workout_logs','id'),('workout_logs','user_id'),('workout_logs','member_id'),
    ('workout_logs','gym_id'),('workout_logs','activity_type'),('workout_logs','duration_minutes'),
    ('workout_logs','calories_burned'),('workout_logs','created_at'),
    -- activity_log (notifications)
    ('activity_log','id'),('activity_log','member_id'),('activity_log','activity_type'),
    ('activity_log','description'),('activity_log','is_read'),('activity_log','created_at'),
    -- inventory
    ('inventory','id'),('inventory','gym_id'),('inventory','item_name'),('inventory','category'),
    ('inventory','price'),('inventory','stock_quantity'),('inventory','image_url'),
    -- payments
    ('payments','id'),('payments','member_id'),('payments','gym_id'),('payments','gym_owner_id'),
    ('payments','amount'),('payments','plan_name'),('payments','status'),('payments','payment_date'),
    -- check_ins (attendance)
    ('check_ins','id'),('check_ins','member_id'),('check_ins','status'),
    ('check_ins','check_in_time'),('check_ins','created_at'),
    -- member_notes
    ('member_notes','id'),('member_notes','member_id'),('member_notes','note_date'),
    ('member_notes','note_content'),('member_notes','created_at'),('member_notes','updated_at')
),
expected_tbls(tbl) as (
  values ('profiles'),('members'),('gym_settings'),('gym_profiles'),('gym_plans'),
         ('gym_leaderboard'),('workout_logs'),('activity_log'),('inventory'),
         ('payments'),('check_ins'),('member_notes')
),
present_cols as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
),
col_report as (
  select 'COLUMN'::text as section,
         (e.tbl || '.' || e.col)::text as object,
         ''::text as detail,
         case when p.column_name is null then 'MISSING' else 'ok' end as status
  from expected_cols e
  left join present_cols p on p.table_name = e.tbl and p.column_name = e.col
),
tbl_report as (
  select 'TABLE'::text,
         t.tbl::text,
         coalesce((select 'rls_enabled=' || cl.relrowsecurity::text
                   from pg_class cl
                   where cl.relname = t.tbl and cl.relnamespace = 'public'::regnamespace), '')::text,
         case when not exists (
           select 1 from information_schema.tables
           where table_schema = 'public' and table_name = t.tbl
         ) then 'MISSING' else 'ok' end
  from expected_tbls t
),
rt_report as (
  select 'REALTIME'::text,
         t.tbl::text,
         ''::text,
         case when exists (
           select 1 from pg_publication_tables
           where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t.tbl
         ) then 'ok' else 'OFF' end
  from expected_tbls t
),
pol_report as (
  select 'RLS_POLICY'::text,
         t.tbl::text,
         coalesce((select string_agg(policyname, ', ')
                   from pg_policies
                   where schemaname = 'public' and tablename = t.tbl), '(none)')::text,
         case when exists (
           select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl
         ) then 'ok' else 'NONE' end
  from expected_tbls t
)
-- The UNION is wrapped in a subquery so ORDER BY can use a CASE expression.
-- (Postgres forbids expressions in an ORDER BY applied directly to a set op.)
select * from (
  select * from col_report
  union all select * from tbl_report
  union all select * from rt_report
  union all select * from pol_report
) q
order by
  case q.section when 'TABLE' then 1 when 'COLUMN' then 2 when 'REALTIME' then 3 else 4 end,
  q.status desc,   -- surfaces MISSING / OFF / NONE first
  q.object;
