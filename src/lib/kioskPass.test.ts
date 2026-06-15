import { describe, it, expect } from "vitest";
import {
  buildMemberPass,
  parseMemberPass,
  evaluatePassPreLookup,
  evaluateMember,
  type MemberRow,
} from "@/lib/kioskPass";

// Ported from the legacy hand-run kioskPass.e2e.ts so the security-critical
// pure logic is now under the automated suite. The `members` table has no
// gym-scoped read policy, so the gym_owner_id check in evaluateMember is the
// TRUE cross-gym guard — these tests lock that behavior in.

const OWNER_A = "owner-aaaaaaaa-aaaa-aaaa-aaaaaaaaaaaa";
const OWNER_B = "owner-bbbbbbbb-bbbb-bbbb-bbbbbbbbbbbb";
const GYM_A = "11111111-1111-1111-1111-111111111111";
const GYM_B = "22222222-2222-2222-2222-222222222222";

const M = (over: Partial<MemberRow> & { id: string }): MemberRow => ({
  full_name: "Member",
  status: "Active",
  gym_id: GYM_A,
  gym_owner_id: OWNER_A,
  ...over,
});

// Simulate the kiosk's full decision flow for one scan (no gym scoping on read).
function runScan(
  decoded: string,
  kioskGymId: string | null,
  kioskOwnerId: string | null,
  member: MemberRow | null,
): string {
  const pre = evaluatePassPreLookup(decoded, kioskGymId);
  if (pre.kind === "reject") return `reject:${pre.overlayLabel}`;
  const decision = evaluateMember(member, false, kioskOwnerId);
  if (decision.kind === "reject") return `reject:${decision.overlayLabel}`;
  return `logged:${decision.status} (${decision.member.full_name})`;
}

describe("buildMemberPass / parseMemberPass round-trip", () => {
  it("is its own inverse and handles edge cases", () => {
    const payload = buildMemberPass({ id: "m1", gym_id: GYM_A });
    expect(payload).toBe(`{"member_id":"m1","gym_id":"${GYM_A}"}`);
    const parsed = parseMemberPass(payload);
    expect(parsed.memberId).toBe("m1");
    expect(parsed.qrGymId).toBe(GYM_A);
    expect(buildMemberPass({ id: "x" })).toBe('{"member_id":"x","gym_id":null}');
    expect(buildMemberPass({ id: "" })).toBe("");
  });

  it("decodes a bare UUID as a legacy member id with no gym", () => {
    const parsed = parseMemberPass("aaaa1111-0000-0000-0000-000000000003");
    expect(parsed.memberId).toBe("aaaa1111-0000-0000-0000-000000000003");
    expect(parsed.qrGymId).toBeNull();
  });
});

describe("happy path", () => {
  it("grants an active member at their own gym", () => {
    const member = M({ id: "m1", full_name: "Hanuman" });
    expect(runScan(buildMemberPass(member), GYM_A, OWNER_A, member)).toBe("logged:granted (Hanuman)");
  });
});

describe("membership status", () => {
  it("logs-but-denies an expired member (not a hard reject)", () => {
    const member = M({ id: "m2", full_name: "Expired Ed", status: "Expired" });
    expect(runScan(buildMemberPass(member), GYM_A, OWNER_A, member)).toBe("logged:denied (Expired Ed)");
  });
});

describe("cross-gym defense", () => {
  it("rejects a foreign member's JSON pass pre-DB on the QR gym", () => {
    const fred = M({ id: "f1", full_name: "Foreign Fred", gym_id: GYM_B, gym_owner_id: OWNER_B });
    expect(runScan(buildMemberPass(fred), GYM_A, OWNER_A, fred)).toBe("reject:Wrong gym");
  });

  it("rejects a foreign member's LEGACY bare UUID post-DB via gym_owner_id", () => {
    const fred = M({ id: "bbbb2222-0000-0000-0000-000000000007", full_name: "Foreign Fred", gym_id: GYM_B, gym_owner_id: OWNER_B });
    expect(runScan(fred.id, GYM_A, OWNER_A, fred)).toBe("reject:Wrong gym");
  });

  it("rejects a forged pass that claims a different gym", () => {
    const lou = M({ id: "aaaa1111-0000-0000-0000-000000000003", full_name: "Legacy Lou" });
    const forged = JSON.stringify({ member_id: lou.id, gym_id: GYM_B });
    expect(runScan(forged, GYM_A, OWNER_A, lou)).toBe("reject:Wrong gym");
  });
});

describe("garbage / abuse inputs", () => {
  it("rejects wall posters, empty, malformed, and unlinked kiosks", () => {
    expect(runScan(JSON.stringify({ gym_id: GYM_A }), GYM_A, OWNER_A, null)).toBe("reject:Invalid pass");
    expect(runScan("", GYM_A, OWNER_A, null)).toBe("reject:Invalid pass");
    expect(runScan("{member_id:", GYM_A, OWNER_A, null)).toBe("reject:Invalid pass");
    expect(runScan(buildMemberPass(M({ id: "m1" })), null, null, M({ id: "m1" }))).toBe("reject:Setup incomplete");
  });

  it("rejects a bogus id that isn't found", () => {
    expect(runScan("hello world", GYM_A, OWNER_A, null)).toBe("reject:Not found");
  });

  it("tolerates whitespace-padded JSON passes", () => {
    const member = M({ id: "m1", full_name: "Hanuman" });
    expect(runScan(`  ${buildMemberPass(member)}  `, GYM_A, OWNER_A, member)).toBe("logged:granted (Hanuman)");
  });
});
