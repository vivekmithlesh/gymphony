// Standalone verification of the kiosk pass logic. Run with:
//   node --experimental-strip-types src/lib/kioskPass.e2e.ts
// It exercises the FULL decode→pre-DB→post-DB decision flow the kiosk runs for
// every scan, simulating the DB lookup with an in-memory members table.
//
// IMPORTANT modeling note: the real `members` table has NO gym-scoped SELECT
// policy, so a foreign member's row IS readable at any kiosk. The harness
// reflects that — lookup returns the row regardless of gym — which is precisely
// why the gym_owner_id guard in evaluateMember is the true cross-gym defense.

import {
  buildMemberPass,
  parseMemberPass,
  evaluatePassPreLookup,
  evaluateMember,
  type MemberRow,
} from './kioskPass.ts';

const OWNER_A = 'owner-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OWNER_B = 'owner-bbbbbbbb-bbbb-bbbb-bbbbbbbbbbbb';
const GYM_A = '11111111-1111-1111-1111-111111111111';
const GYM_B = '22222222-2222-2222-2222-222222222222';

const M = (over: Partial<MemberRow> & { id: string }): MemberRow => ({
  full_name: 'Member', status: 'Active', gym_id: GYM_A, gym_owner_id: OWNER_A, ...over,
});

// In-memory stand-in for `members`, readable by id with NO gym scoping —
// matching the real table's lack of a gym-scoped read policy.
const MEMBERS: Record<string, MemberRow> = {
  'aaaa1111-0000-0000-0000-000000000001': M({ id: 'aaaa1111-0000-0000-0000-000000000001', full_name: 'Hanuman' }),
  'aaaa1111-0000-0000-0000-000000000002': M({ id: 'aaaa1111-0000-0000-0000-000000000002', full_name: 'Expired Ed', status: 'Expired' }),
  'aaaa1111-0000-0000-0000-000000000003': M({ id: 'aaaa1111-0000-0000-0000-000000000003', full_name: 'Legacy Lou' }), // bare-UUID pass
  'bbbb2222-0000-0000-0000-000000000007': M({ id: 'bbbb2222-0000-0000-0000-000000000007', full_name: 'Foreign Fred', gym_id: GYM_B, gym_owner_id: OWNER_B }),
  'cccc3333-0000-0000-0000-000000000009': M({ id: 'cccc3333-0000-0000-0000-000000000009', full_name: 'Orphan Nora', gym_id: null, gym_owner_id: null }), // integrity gap
};

// Simulates the kiosk's full handler for ONE scan, returning the terminal
// effect: 'logged:granted' | 'logged:denied' | a rejection label.
function runScan(decodedText: string, kioskGymId: string | null, kioskOwnerId: string | null): string {
  const pre = evaluatePassPreLookup(decodedText, kioskGymId);
  if (pre.kind === 'reject') return `reject:${pre.overlayLabel}`;

  const member = MEMBERS[pre.memberId] ?? null; // no gym scoping on the read
  const decision = evaluateMember(member, false, kioskOwnerId);
  if (decision.kind === 'reject') return `reject:${decision.overlayLabel}`;
  return `logged:${decision.status} (${decision.member.full_name})`;
}

// The kiosk under test is OWNER_A operating GYM_A.
const scan = (text: string) => runScan(text, GYM_A, OWNER_A);

let pass = 0;
let fail = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '✅' : '❌'} ${name}\n     got:  ${got}\n     want: ${want}`);
}

console.log('── Payload round-trip (card → kiosk) ────────────────────────────');
{
  const payload = buildMemberPass({ id: 'aaaa1111-0000-0000-0000-000000000001', gym_id: GYM_A });
  check('card emits JSON pass', payload, `{"member_id":"aaaa1111-0000-0000-0000-000000000001","gym_id":"${GYM_A}"}`);
  const parsed = parseMemberPass(payload);
  check('kiosk decodes member id', parsed.memberId ?? 'null', 'aaaa1111-0000-0000-0000-000000000001');
  check('kiosk decodes gym id', parsed.qrGymId ?? 'null', GYM_A);
  check('null gym_id encodes as null (no crash)', buildMemberPass({ id: 'x' }), '{"member_id":"x","gym_id":null}');
  check('empty member id → empty payload', buildMemberPass({ id: '' }), '');
}

console.log('\n── Happy path ───────────────────────────────────────────────────');
check('active member, own gym (JSON pass)',
  scan(buildMemberPass(MEMBERS['aaaa1111-0000-0000-0000-000000000001'])),
  'logged:granted (Hanuman)');
check('active member, own gym (legacy bare UUID)',
  scan('aaaa1111-0000-0000-0000-000000000003'),
  'logged:granted (Legacy Lou)');

console.log('\n── Membership status ────────────────────────────────────────────');
check('expired member is logged but DENIED (not hard-rejected)',
  scan(buildMemberPass(MEMBERS['aaaa1111-0000-0000-0000-000000000002'])),
  'logged:denied (Expired Ed)');

console.log('\n── Cross-gym defense (the core requirement) ─────────────────────');
check('foreign member, JSON pass → rejected pre-DB on QR gym (no DB hit)',
  scan(buildMemberPass(MEMBERS['bbbb2222-0000-0000-0000-000000000007'])),
  'reject:Wrong gym');
check('foreign member, LEGACY bare UUID → caught post-DB by gym_owner_id guard',
  // The dangerous case: no gym in the QR, and the row IS readable. Only the
  // gym_owner_id check stops it.
  scan('bbbb2222-0000-0000-0000-000000000007'),
  'reject:Wrong gym');
check('own member id but pass forged to claim a different gym → pre-DB reject',
  scan(JSON.stringify({ member_id: 'aaaa1111-0000-0000-0000-000000000003', gym_id: GYM_B })),
  'reject:Wrong gym');

console.log('\n── Data-integrity gap: member with null gym_owner_id ────────────');
check('orphan member (null owner) scanned at GYM_A → LOGGED (no key to reject on)',
  scan('cccc3333-0000-0000-0000-000000000009'),
  'logged:granted (Orphan Nora)');
check('SAME orphan scanned at a DIFFERENT gym (GYM_B) → ALSO logged = the hazard',
  runScan('cccc3333-0000-0000-0000-000000000009', GYM_B, OWNER_B),
  'logged:granted (Orphan Nora)');
// ^ An orphaned member checks in at ANY gym. This is exactly why the cleanup
//   query below matters: a null gym_owner_id disables the cross-gym guard.

console.log('\n── Garbage / abuse inputs ───────────────────────────────────────');
check('wall-poster QR ({"gym_id":...}, no member_id) → not a member pass',
  scan(JSON.stringify({ gym_id: GYM_A })), 'reject:Invalid pass');
check('empty scan', scan(''), 'reject:Invalid pass');
check('malformed JSON', scan('{member_id:'), 'reject:Invalid pass');
check('non-JSON junk → bogus bare id → not found', scan('hello world'), 'reject:Not found');
check('kiosk not linked to a gym yet',
  runScan(buildMemberPass(MEMBERS['aaaa1111-0000-0000-0000-000000000001']), null, null),
  'reject:Setup incomplete');
check('whitespace-padded JSON pass still decodes',
  scan('   ' + buildMemberPass(MEMBERS['aaaa1111-0000-0000-0000-000000000001']) + '  '),
  'logged:granted (Hanuman)');

console.log(`\n──────────────────────────────────────────────\n${fail === 0 ? '✅ ALL PASSED' : '❌ FAILURES'}: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
