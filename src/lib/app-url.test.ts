import { describe, it, expect } from "vitest";
import { buildJoinUrl, buildCheckinUrl, parseGymQr, extractGymIdFromQr } from "@/lib/app-url";

const GYM = "11111111-1111-1111-1111-111111111111";
const ORIGIN = "https://app.gymphony.test";

describe("buildJoinUrl / buildCheckinUrl", () => {
  it("encodes the gym id into the canonical deep-link path", () => {
    expect(buildJoinUrl(GYM).endsWith(`/join/${GYM}`)).toBe(true);
    expect(buildCheckinUrl(GYM).endsWith(`/checkin/${GYM}`)).toBe(true);
  });
});

describe("parseGymQr", () => {
  it("reads the gym id + intent from the new URL form", () => {
    expect(parseGymQr(`${ORIGIN}/join/${GYM}`)).toEqual({ kind: "join", gymId: GYM });
    expect(parseGymQr(`${ORIGIN}/checkin/${GYM}`)).toEqual({ kind: "checkin", gymId: GYM });
    // Works with query strings / trailing noise that some camera apps append.
    expect(parseGymQr(`${ORIGIN}/checkin/${GYM}?utm=qr`)).toEqual({ kind: "checkin", gymId: GYM });
  });

  it("still reads the legacy JSON + bare-uuid forms", () => {
    expect(parseGymQr(JSON.stringify({ action: "join", gym_id: GYM }))).toEqual({
      kind: "join",
      gymId: GYM,
    });
    expect(parseGymQr(JSON.stringify({ gym_id: GYM }))).toEqual({ kind: "gym", gymId: GYM });
    expect(parseGymQr(GYM)).toEqual({ kind: "gym", gymId: GYM });
  });

  it("returns null for empty / junk input", () => {
    expect(parseGymQr("")).toEqual({ kind: null, gymId: null });
    expect(parseGymQr("hello world")).toEqual({ kind: null, gymId: null });
    expect(parseGymQr("{not json")).toEqual({ kind: null, gymId: null });
  });

  it("extractGymIdFromQr is a thin gym-id accessor over parseGymQr", () => {
    expect(extractGymIdFromQr(`${ORIGIN}/join/${GYM}`)).toBe(GYM);
    expect(extractGymIdFromQr("garbage")).toBeNull();
  });
});
