-- ============================================================================
-- subscription_security_test.sql  — P0 stress-test harness
-- Run in the Supabase SQL editor AFTER applying 20260620 + 20260621.
-- Each block RAISES on failure; if the whole script runs to "ALL PASS" you're
-- protected. It cleans up its own fixtures.
--
-- NOTE: the SQL editor runs as the most-privileged role. The lockdown is a
-- TRIGGER (fires for every role) + a GUC flag set only inside SECURITY DEFINER
-- funcs — so even this privileged session cannot forge a plan. That's the point.
-- ============================================================================
do $$
declare
  v_owner uuid := gen_random_uuid();
  v_gym   uuid := gen_random_uuid();
  v_blocked boolean;
  v_count int;
begin
  -- Fixture: one gym on an ACTIVE STARTER plan (100 cap), owned by v_owner.
  insert into public.gym_settings (id, gym_owner_id, gym_name, plan_tier, plan_status, billing_cycle)
  values (v_gym, v_owner, 'TEST GYM', 'starter', 'active', 'monthly');

  -- ── TEST 1: raw plan UPDATE must be blocked by the lockdown trigger ────────
  v_blocked := false;
  begin
    update public.gym_settings set plan_tier = 'pro', plan_status = 'active'
    where id = v_gym;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL T1: raw plan_tier UPDATE was allowed (self-grant Pro possible)';
  end if;
  raise notice 'PASS T1: direct plan UPDATE blocked';

  -- ── TEST 2: trial-reset via raw UPDATE must be blocked ─────────────────────
  v_blocked := false;
  begin
    update public.gym_settings set trial_ends_at = now() + interval '7 days'
    where id = v_gym;
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL T2: trial_ends_at UPDATE was allowed (infinite trial possible)';
  end if;
  raise notice 'PASS T2: trial reset blocked';

  -- ── TEST 3: authorized writer (app_set_owner_plan) DOES work ───────────────
  perform public.app_set_owner_plan(v_owner, 'growth', 'active', 'monthly', null);
  select plan_tier into v_blocked from public.gym_settings where id = v_gym; -- reuse var loosely
  if (select plan_tier from public.gym_settings where id = v_gym) <> 'growth' then
    raise exception 'FAIL T3: app_set_owner_plan did not set the plan';
  end if;
  raise notice 'PASS T3: webhook writer (app_set_owner_plan) works';

  -- Put the gym back on Starter (100) for the member-limit test.
  perform public.app_set_owner_plan(v_owner, 'starter', 'active', 'monthly', null);

  -- ── TEST 4: member-limit enforcement — fill to 100, block #101 ─────────────
  insert into public.profiles (id, gym_id, role)
  select gen_random_uuid(), v_gym, 'member' from generate_series(1, 100);

  select count(*) into v_count from public.profiles
    where gym_id = v_gym and coalesce(role,'member') <> 'owner';
  if v_count <> 100 then
    raise exception 'FAIL T4 setup: expected 100 members, got %', v_count;
  end if;

  v_blocked := false;
  begin
    insert into public.profiles (id, gym_id, role) values (gen_random_uuid(), v_gym, 'member');
  exception when others then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception 'FAIL T4: 101st member on Starter was allowed (limit bypass)';
  end if;
  raise notice 'PASS T4: 101st member blocked on Starter (100 cap enforced)';

  -- ── TEST 5: owner profile row is never limited ─────────────────────────────
  begin
    insert into public.profiles (id, gym_id, role) values (v_owner, v_gym, 'owner');
    raise notice 'PASS T5: owner profile insert not blocked by member cap';
  exception when others then
    raise exception 'FAIL T5: owner profile insert was blocked by member cap';
  end;

  -- ── Cleanup ────────────────────────────────────────────────────────────────
  delete from public.profiles    where gym_id = v_gym;
  delete from public.gym_settings where id = v_gym;

  raise notice '================ ALL PASS ================';
end $$;

-- ── TEST 6 (tenancy): no two owners should share a gym_id going forward ──────
-- Existing rows created before the fix may still carry the old hardcoded
-- constant; investigate any group with count > 1.
select gym_id, count(*) as owners
from public.profiles
where coalesce(role,'') = 'owner'
group by gym_id
having count(*) > 1;
-- ^ Expect ZERO rows. Any row = legacy shared-gym_id owners to backfill with
--   unique ids (one-off): they predate 20260621's signup fix.
