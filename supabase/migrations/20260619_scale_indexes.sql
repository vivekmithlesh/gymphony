-- =============================================================================
-- Scale indexes — back the hot owner-dashboard read paths at 1,000+ members.
-- -----------------------------------------------------------------------------
-- Evidence (every index maps to a real query in the app, not a guess):
--
--   payments(gym_owner_id, created_at desc)
--       RevenueView.fetchData  → payments.eq(gym_owner_id).order(created_at)
--       dashboard.fetchMembersCounts → payments.eq(gym_owner_id)
--       Today the owner's whole payment ledger is a seq-scan + sort.
--
--   payments(member_id)
--       MembersList.fetchMembers     → payments.in(member_id, [...500 ids])
--       dashboard amount-paid rollup → payments.in(member_id, [...])
--
--   profiles(gym_id)
--       `members` is a VIEW over profiles; every "members for this gym" filter
--       (members.gym_id) and RevenueView profiles.eq(gym_id) resolve to a
--       profiles.gym_id predicate. expire_overdue_members joins on it too.
--
--   check_ins(gym_id, check_in_time desc)
--       AttendanceHeatmap (.gte check_in_time), process_wall_checkin 4h dup
--       guard, and get_gym_today_stats all filter by check_in_time — but the
--       only existing check_ins index (20260602) is on created_at, so these
--       range scans are NOT covered. The live-count query DOES use created_at
--       and keeps its existing index.
--
--   activity_log(gym_owner_id, created_at desc)
--       dashboard.fetchNotifications / fetchRecentActivities →
--       activity_log.eq(gym_owner_id).order(created_at desc).limit(...)
--
--   gym_settings(gym_owner_id)
--       The single most frequent lookup in the app — every page resolves the
--       gym via gym_settings.eq(gym_owner_id). Cheap insurance if not already
--       backed by a unique constraint.
--
-- All guarded so a missing column can never abort the migration, and all
-- IF NOT EXISTS so this is idempotent / safe to re-run.
--
-- NOTE for large LIVE tables: plain CREATE INDEX takes a brief write lock. If a
-- table already holds millions of rows, run the equivalent
-- `CREATE INDEX CONCURRENTLY ...` by hand OUTSIDE a transaction instead. For the
-- target scale (1k members, low-hundreds of thousands of check-ins) the locks
-- here are sub-second.
-- =============================================================================

do $$
declare
  -- index_name, table, column-list, the columns that must all exist
  specs text[][] := array[
    array['payments_owner_created_idx',     'payments',     '(gym_owner_id, created_at desc)', 'gym_owner_id,created_at'],
    array['payments_member_id_idx',         'payments',     '(member_id)',                      'member_id'],
    array['profiles_gym_id_idx',            'profiles',     '(gym_id)',                         'gym_id'],
    array['check_ins_gym_checkin_time_idx', 'check_ins',    '(gym_id, check_in_time desc)',     'gym_id,check_in_time'],
    array['activity_log_owner_created_idx', 'activity_log', '(gym_owner_id, created_at desc)',  'gym_owner_id,created_at'],
    array['gym_settings_owner_idx',         'gym_settings', '(gym_owner_id)',                   'gym_owner_id']
  ];
  spec     text[];
  idx_name text;
  tbl      text;
  col_list text;
  req_cols text;
  col      text;
  ok       boolean;
begin
  foreach spec slice 1 in array specs loop
    idx_name := spec[1];
    tbl      := spec[2];
    col_list := spec[3];
    req_cols := spec[4];

    -- Table present?
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = tbl
    ) then
      raise notice 'skip %: table public.% not found', idx_name, tbl;
      continue;
    end if;

    -- Every required column present?
    ok := true;
    foreach col in array string_to_array(req_cols, ',') loop
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = tbl and column_name = col
      ) then
        ok := false;
        raise notice 'skip %: column %.% not found', idx_name, tbl, col;
        exit;
      end if;
    end loop;

    if ok then
      execute format(
        'create index if not exists %I on public.%I %s',
        idx_name, tbl, col_list
      );
      raise notice 'ensured index % on public.%', idx_name, tbl;
    end if;
  end loop;
end$$;
