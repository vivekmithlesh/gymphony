-- =====================================================================
-- 20260625 — QR security: signed member passes, server-authoritative
-- kiosk check-in, scan history / audit log, and orphan-member fix.
-- =====================================================================
-- PROBLEM (audit F4): the member pass was plaintext JSON {member_id,gym_id}
-- with no signature, no expiry and no nonce — trivially forgeable. The kiosk
-- did the whole check-in CLIENT-SIDE (read members, insert check_ins +
-- activity_log), so the browser was the trust boundary. Members whose
-- profiles.gym_owner_id was NULL bypassed the only cross-gym guard.
--
-- THIS MIGRATION moves the trust boundary into the database:
--   • HMAC-SHA256 signing key kept in an RLS-locked app_config table — it is
--     NEVER sent to any client (a client-held key would be worthless).
--   • mint_member_pass()  → issues a short-lived SIGNED pass for the caller.
--   • kiosk_check_in(token)→ verifies signature + expiry + cross-gym ownership
--     server-side, dedupes, then records the check-in. The browser can no
--     longer fabricate attendance.
--   • qr_scans               → every scan attempt (accept/deny/forged/expired)
--     is logged: scan history + audit trail + analytics source.
--   • Legacy unsigned passes are still accepted WHILE app_config.qr_allow_legacy
--     is 'true' (default) so existing member apps keep working during rollout;
--     flip it to 'false' once clients ship the signed pass to enforce signing.
--
-- Idempotent and safe to re-run.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. app_config — private key/value store. RLS ON with NO policies, so
--    anon/authenticated can never read it; only SECURITY DEFINER functions
--    (which run as the table owner) can.
-- ---------------------------------------------------------------------
create table if not exists public.app_config (
  key   text primary key,
  value text not null
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- Seed a 256-bit signing key ONCE (re-running never rotates it).
insert into public.app_config (key, value)
values ('qr_signing_key', encode(gen_random_bytes(32), 'hex'))
on conflict (key) do nothing;

-- Rollout flag: accept legacy unsigned passes until clients ship signing.
insert into public.app_config (key, value)
values ('qr_allow_legacy', 'true')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 2. qr_scans — scan history / audit log / analytics
-- ---------------------------------------------------------------------
create table if not exists public.qr_scans (
  id             uuid primary key default gen_random_uuid(),
  kiosk_owner_id uuid,
  member_id      uuid,
  gym_id         uuid,
  source         text not null default 'kiosk',  -- 'kiosk' | 'wall'
  result         text not null,                  -- granted|denied|expired|forged|wrong_gym|invalid|legacy
  reason         text,
  created_at     timestamptz not null default now()
);
create index if not exists qr_scans_owner_created_idx on public.qr_scans (kiosk_owner_id, created_at desc);
create index if not exists qr_scans_gym_created_idx   on public.qr_scans (gym_id, created_at desc);

alter table public.qr_scans enable row level security;
drop policy if exists qr_scans_owner_select on public.qr_scans;
create policy qr_scans_owner_select on public.qr_scans
  for select to authenticated using (kiosk_owner_id = auth.uid());

-- ---------------------------------------------------------------------
-- 3. Orphan fix — backfill profiles.gym_owner_id from the gym so the
--    cross-gym guard can never be bypassed by a NULL owner.
-- ---------------------------------------------------------------------
update public.profiles p
   set gym_owner_id = g.gym_owner_id
  from public.gym_settings g
 where p.gym_id = g.id
   and p.gym_owner_id is null
   and g.gym_owner_id is not null;

-- ---------------------------------------------------------------------
-- 4. mint_member_pass() — issue a short-lived SIGNED pass for the caller.
--    Token = base64(payload_json) || '.' || hex(hmac_sha256(b64, key)).
-- ---------------------------------------------------------------------
create or replace function public.mint_member_pass()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid      uuid := auth.uid();
  v_gym      uuid;
  v_owner    uuid;
  v_key      text;
  v_ttl      constant integer := 900;  -- seconds (15 min)
  v_now      bigint := floor(extract(epoch from now()));
  v_payload  jsonb;
  v_b64      text;
  v_sig      text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select coalesce(m.gym_id, p.gym_id), coalesce(m.gym_owner_id, p.gym_owner_id)
    into v_gym, v_owner
  from public.profiles p
  left join public.members m on m.id = p.id
  where p.id = v_uid;

  select value into v_key from public.app_config where key = 'qr_signing_key';
  if v_key is null then
    raise exception 'qr signing key not configured';
  end if;

  v_payload := jsonb_build_object(
    'v',   1,
    'mid', v_uid,
    'gid', v_gym,
    'oid', v_owner,
    'iat', v_now,
    'exp', v_now + v_ttl,
    'jti', encode(gen_random_bytes(8), 'hex')
  );

  -- Postgres base64 wraps at 76 chars; strip newlines so it survives a QR.
  v_b64 := translate(encode(convert_to(v_payload::text, 'utf8'), 'base64'), E'\n', '');
  v_sig := encode(hmac(v_b64, v_key, 'sha256'), 'hex');

  return jsonb_build_object(
    'token',      v_b64 || '.' || v_sig,
    'expires_at', to_timestamp(v_now + v_ttl),
    'ttl',        v_ttl
  );
end;
$$;

revoke all on function public.mint_member_pass() from public, anon;
grant execute on function public.mint_member_pass() to authenticated;

-- ---------------------------------------------------------------------
-- 5. kiosk_check_in(p_token) — SERVER-AUTHORITATIVE check-in.
--    Verifies a signed pass (or a legacy pass while allowed), enforces the
--    cross-gym ownership guard, dedupes, records check_ins + qr_scans +
--    owner activity feed, and returns the outcome.
-- ---------------------------------------------------------------------
create or replace function public.kiosk_check_in(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner        uuid := auth.uid();
  v_kiosk_gym    uuid;
  v_key          text;
  v_allow_legacy boolean;
  v_dedupe       constant interval := interval '10 minutes';
  v_now          timestamptz := now();

  v_parts        text[];
  v_b64          text;
  v_sig          text;
  v_expected     text;
  v_payload      jsonb;
  v_signed       boolean := false;

  v_member_id    uuid;
  v_member_name  text;
  v_member_status text;
  v_member_owner uuid;
  v_access       text;
  v_checkin_id   uuid;
begin
  if v_owner is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  -- Kiosk's own gym (the device is signed in as the gym owner).
  select id into v_kiosk_gym from public.gym_settings where gym_owner_id = v_owner;
  if v_kiosk_gym is null then
    insert into public.qr_scans (kiosk_owner_id, result, reason, source)
    values (v_owner, 'invalid', 'kiosk not linked to a gym', 'kiosk');
    return jsonb_build_object('success', false, 'overlay', 'Setup incomplete',
      'error', 'This kiosk is not linked to a gym yet.');
  end if;

  select value into v_key from public.app_config where key = 'qr_signing_key';
  select (value = 'true') into v_allow_legacy from public.app_config where key = 'qr_allow_legacy';

  -- ---- Parse: signed token (has a '.') vs legacy payload ----
  if position('.' in coalesce(p_token, '')) > 0 then
    v_parts := string_to_array(p_token, '.');
    if array_length(v_parts, 1) = 2 then
      v_b64 := v_parts[1];
      v_sig := v_parts[2];
      v_expected := encode(hmac(v_b64, coalesce(v_key, ''), 'sha256'), 'hex');
      if v_sig = v_expected then
        begin
          v_payload := convert_from(decode(v_b64, 'base64'), 'utf8')::jsonb;
          v_signed := true;
        exception when others then
          v_signed := false;
        end;
      end if;
    end if;

    if not v_signed then
      insert into public.qr_scans (kiosk_owner_id, gym_id, result, reason, source)
      values (v_owner, v_kiosk_gym, 'forged', 'signature mismatch or malformed token', 'kiosk');
      return jsonb_build_object('success', false, 'overlay', 'Invalid pass',
        'error', 'This pass could not be verified.');
    end if;

    -- Expiry
    if (v_payload->>'exp')::bigint < floor(extract(epoch from v_now)) then
      v_member_id := (v_payload->>'mid')::uuid;
      insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, result, reason, source)
      values (v_owner, v_member_id, v_kiosk_gym, 'expired', 'pass expired', 'kiosk');
      return jsonb_build_object('success', false, 'overlay', 'Expired',
        'error', 'This pass has expired. Ask the member to refresh their app.');
    end if;

    v_member_id := (v_payload->>'mid')::uuid;
  else
    -- Legacy unsigned pass: bare UUID or {"member_id":...}
    if not coalesce(v_allow_legacy, true) then
      insert into public.qr_scans (kiosk_owner_id, gym_id, result, reason, source)
      values (v_owner, v_kiosk_gym, 'invalid', 'legacy pass rejected (signing enforced)', 'kiosk');
      return jsonb_build_object('success', false, 'overlay', 'Update required',
        'error', 'Please update the Gymphony app to check in.');
    end if;

    begin
      if position('{' in coalesce(p_token, '')) > 0 then
        v_member_id := (p_token::jsonb->>'member_id')::uuid;
      else
        v_member_id := nullif(trim(p_token), '')::uuid;
      end if;
    exception when others then
      v_member_id := null;
    end;

    if v_member_id is null then
      insert into public.qr_scans (kiosk_owner_id, gym_id, result, reason, source)
      values (v_owner, v_kiosk_gym, 'invalid', 'unrecognized QR', 'kiosk');
      return jsonb_build_object('success', false, 'overlay', 'Invalid pass',
        'error', 'Unrecognized QR — that is not a Gymphony member pass.');
    end if;
  end if;

  -- ---- Resolve the member ----
  select coalesce(full_name, member_name, 'Member'), status, gym_owner_id
    into v_member_name, v_member_status, v_member_owner
  from public.members
  where id = v_member_id;

  if not found then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, result, reason, source)
    values (v_owner, v_member_id, v_kiosk_gym, 'invalid', 'member not found', 'kiosk');
    return jsonb_build_object('success', false, 'overlay', 'Not found',
      'error', 'Member not found.');
  end if;

  -- ---- CROSS-GYM GUARD (the primary security boundary) ----
  if v_member_owner is distinct from v_owner then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, result, reason, source)
    values (v_owner, v_member_id, v_kiosk_gym, 'wrong_gym', 'member belongs to another gym', 'kiosk');
    return jsonb_build_object('success', false, 'overlay', 'Wrong gym',
      'error', 'This pass belongs to a different gym.');
  end if;

  -- ---- Access status: Overdue/Expired => logged-but-denied ----
  v_access := case when v_member_status in ('Overdue', 'Expired') then 'denied' else 'granted' end;

  -- ---- Dedupe rapid re-scans ----
  if exists (
    select 1 from public.check_ins ci
    where ci.member_id = v_member_id
      and ci.gym_id = v_kiosk_gym
      and ci.check_in_time > v_now - v_dedupe
  ) then
    insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, result, reason, source)
    values (v_owner, v_member_id, v_kiosk_gym, v_access, 'duplicate within dedupe window', 'kiosk');
    return jsonb_build_object('success', true, 'already_checked_in', true,
      'member_name', v_member_name, 'status', v_access,
      'message', v_member_name || ' is already checked in.');
  end if;

  -- ---- Record attendance (member notif fires via trg_notify_member_on_checkin) ----
  insert into public.check_ins (member_id, gym_id, status, check_in_time)
  values (v_member_id, v_kiosk_gym, v_access, v_now)
  returning id into v_checkin_id;

  insert into public.qr_scans (kiosk_owner_id, member_id, gym_id, result, reason, source)
  values (v_owner, v_member_id, v_kiosk_gym, v_access, case when v_signed then 'signed' else 'legacy' end, 'kiosk');

  insert into public.activity_log (gym_owner_id, activity_type, description, is_read)
  values (v_owner, 'member', v_member_name || ' checked in via Kiosk (' || v_access || ').', false);

  return jsonb_build_object(
    'success', true,
    'check_in_id', v_checkin_id,
    'member_name', v_member_name,
    'status', v_access,
    'signed', v_signed
  );
end;
$$;

revoke all on function public.kiosk_check_in(text) from public, anon;
grant execute on function public.kiosk_check_in(text) to authenticated;

notify pgrst, 'reload schema';
