import { describe, it, expect } from "vitest";
import { QRValidator } from "@/lib/qr/QRValidator";

const MEMBER = "aaaa1111-0000-0000-0000-000000000001";
const GYM = "11111111-1111-1111-1111-111111111111";

// Build a signed-pass-shaped token: base64(payload).fakehexsig. QRValidator
// can't verify the signature (server-only) — it only classifies + reads exp.
const signedToken = (payload: Record<string, unknown>) =>
  `${btoa(JSON.stringify(payload))}.deadbeefcafef00d`;

describe("QRValidator.parse", () => {
  it("classifies a valid signed member pass and reads its fields", () => {
    const exp = Math.floor(Date.now() / 1000) + 900;
    const r = QRValidator.parse(signedToken({ v: 1, mid: MEMBER, gid: GYM, exp }));
    expect(r.type).toBe("member_pass");
    if (r.type !== "member_pass") return;
    expect(r.signed).toBe(true);
    expect(r.memberId).toBe(MEMBER);
    expect(r.gymId).toBe(GYM);
    expect(r.expired).toBe(false);
  });

  it("flags an expired signed pass via the client clock", () => {
    const exp = Math.floor(Date.now() / 1000) - 60;
    const r = QRValidator.parse(signedToken({ v: 1, mid: MEMBER, gid: GYM, exp }));
    expect(r.type).toBe("member_pass");
    if (r.type !== "member_pass") return;
    expect(r.expired).toBe(true);
  });

  it("treats a legacy JSON member pass as unsigned", () => {
    const r = QRValidator.parse(JSON.stringify({ member_id: MEMBER, gym_id: GYM }));
    expect(r.type).toBe("member_pass");
    if (r.type !== "member_pass") return;
    expect(r.signed).toBe(false);
    expect(r.memberId).toBe(MEMBER);
  });

  it("treats a bare UUID as a legacy member pass", () => {
    const r = QRValidator.parse(MEMBER);
    expect(r.type).toBe("member_pass");
    if (r.type !== "member_pass") return;
    expect(r.signed).toBe(false);
    expect(r.memberId).toBe(MEMBER);
  });

  it("classifies wall and join posters", () => {
    expect(QRValidator.parse(JSON.stringify({ gym_id: GYM }))).toEqual({ type: "wall", gymId: GYM });
    expect(QRValidator.parse(JSON.stringify({ action: "join", gym_id: GYM }))).toEqual({ type: "join", gymId: GYM });
  });

  it("returns unknown for empty / malformed / junk input", () => {
    expect(QRValidator.parse("").type).toBe("unknown");
    expect(QRValidator.parse("{member_id:").type).toBe("unknown"); // malformed JSON
    expect(QRValidator.parse("hello world").type).toBe("unknown");
    expect(QRValidator.parse("{}").type).toBe("unknown");
  });
});

describe("QRValidator.extractGymId", () => {
  it("returns the gym id for wall/join only", () => {
    expect(QRValidator.extractGymId(JSON.stringify({ gym_id: GYM }))).toBe(GYM);
    expect(QRValidator.extractGymId(JSON.stringify({ action: "join", gym_id: GYM }))).toBe(GYM);
    expect(QRValidator.extractGymId(MEMBER)).toBeNull(); // a member pass, not a gym poster
    expect(QRValidator.extractGymId("garbage")).toBeNull();
  });
});
