import { describe, it, expect } from "vitest";
import {
  isValidIndianMobile,
  looksLikeIndianMobile,
  toIndianLocal,
  toIndianE164,
  formatIndianLocalInput,
} from "@/lib/phone";

describe("isValidIndianMobile (strict — form fields)", () => {
  it("accepts ONLY a clean 10-digit Indian mobile starting 6–9", () => {
    expect(isValidIndianMobile("9876543210")).toBe(true);
    expect(isValidIndianMobile("6000000000")).toBe(true);
  });

  it("rejects every invalid example from the spec (digits-only, no symbols)", () => {
    expect(isValidIndianMobile("12345")).toBe(false); // too short
    expect(isValidIndianMobile("98765abcde")).toBe(false); // letters
    expect(isValidIndianMobile("999999999999")).toBe(false); // 12 digits
    expect(isValidIndianMobile("98-76543210")).toBe(false); // contains a symbol
  });

  it("is strict: a +91/0 prefix or spaces are NOT a valid form value", () => {
    expect(isValidIndianMobile("+919876543210")).toBe(false);
    expect(isValidIndianMobile("09876543210")).toBe(false);
    expect(isValidIndianMobile("98765 43210")).toBe(false);
  });

  it("rejects numbers that don't start 6–9 and empty input", () => {
    expect(isValidIndianMobile("1234567890")).toBe(false);
    expect(isValidIndianMobile("5234567890")).toBe(false);
    expect(isValidIndianMobile("")).toBe(false);
    expect(isValidIndianMobile(undefined)).toBe(false);
  });
});

describe("looksLikeIndianMobile (lenient — login recogniser)", () => {
  it("recognises a mobile even with a +91 / 91 / 0 prefix or formatting", () => {
    expect(looksLikeIndianMobile("9876543210")).toBe(true);
    expect(looksLikeIndianMobile("+919876543210")).toBe(true);
    expect(looksLikeIndianMobile("919876543210")).toBe(true);
    expect(looksLikeIndianMobile("09876543210")).toBe(true);
    expect(looksLikeIndianMobile("+91 98765-43210")).toBe(true);
  });

  it("does not treat an email or junk as a mobile", () => {
    expect(looksLikeIndianMobile("owner@gym.com")).toBe(false);
    expect(looksLikeIndianMobile("98765abcde")).toBe(false);
    expect(looksLikeIndianMobile("12345")).toBe(false);
  });
});

describe("toIndianLocal", () => {
  it("collapses prefixed / formatted inputs to the 10-digit local number", () => {
    expect(toIndianLocal("+91 98765 43210")).toBe("9876543210");
    expect(toIndianLocal("09876543210")).toBe("9876543210");
    expect(toIndianLocal("919876543210")).toBe("9876543210");
    expect(toIndianLocal("9876543210")).toBe("9876543210");
  });
});

describe("toIndianE164", () => {
  it("returns +91-prefixed E.164 for valid input, empty string otherwise", () => {
    expect(toIndianE164("9876543210")).toBe("+919876543210");
    expect(toIndianE164("+91 98765 43210")).toBe("+919876543210");
    expect(toIndianE164("98765abcde")).toBe("");
    expect(toIndianE164("12345")).toBe("");
  });
});

describe("formatIndianLocalInput", () => {
  it("keeps digits only and caps at 10 (handles pasted +91)", () => {
    expect(formatIndianLocalInput("98a76b54c32d10")).toBe("9876543210");
    expect(formatIndianLocalInput("+919876543210")).toBe("9876543210");
    expect(formatIndianLocalInput("98765")).toBe("98765");
    expect(formatIndianLocalInput("9876543210999")).toBe("9876543210");
  });
});
