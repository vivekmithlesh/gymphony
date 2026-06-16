import { describe, it, expect } from "vitest";
import {
  isSafeRedirectPath,
  consumeRedirect,
  buildAuthUrlWithRedirect,
  REDIRECT_PARAM,
} from "@/lib/auth-redirect";

describe("isSafeRedirectPath", () => {
  it("accepts same-origin in-app paths", () => {
    expect(isSafeRedirectPath("/checkin/abc")).toBe(true);
    expect(isSafeRedirectPath("/join/abc?x=1")).toBe(true);
    expect(isSafeRedirectPath("/member-dashboard")).toBe(true);
  });

  it("rejects open-redirect and malformed targets", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
    expect(isSafeRedirectPath("//evil.com")).toBe(false); // protocol-relative
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false); // backslash trick
    expect(isSafeRedirectPath("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectPath("checkin/abc")).toBe(false); // not absolute
    expect(isSafeRedirectPath("")).toBe(false);
    expect(isSafeRedirectPath(null)).toBe(false);
    expect(isSafeRedirectPath(undefined)).toBe(false);
  });
});

describe("consumeRedirect", () => {
  it("returns a safe explicit param and rejects unsafe ones", () => {
    // No DOM in the node test env, so the sessionStorage backup is simply absent;
    // the explicit param drives the result.
    expect(consumeRedirect("/checkin/abc")).toBe("/checkin/abc");
    expect(consumeRedirect("https://evil.com")).toBeNull();
    expect(consumeRedirect(null)).toBeNull();
    expect(consumeRedirect(undefined)).toBeNull();
  });
});

describe("buildAuthUrlWithRedirect", () => {
  it("appends an encoded redirect param", () => {
    expect(buildAuthUrlWithRedirect("/member-login", "/checkin/abc")).toBe(
      `/member-login?${REDIRECT_PARAM}=${encodeURIComponent("/checkin/abc")}`,
    );
  });

  it("uses & when the base already has a query string", () => {
    expect(buildAuthUrlWithRedirect("/member-login?x=1", "/join/abc")).toBe(
      `/member-login?x=1&${REDIRECT_PARAM}=${encodeURIComponent("/join/abc")}`,
    );
  });

  it("never appends an unsafe redirect", () => {
    expect(buildAuthUrlWithRedirect("/member-login", "https://evil.com")).toBe("/member-login");
  });
});
