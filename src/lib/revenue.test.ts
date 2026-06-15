import { describe, it, expect } from "vitest";
import { isApprovedPayment, sumApprovedPayments } from "@/lib/revenue";

describe("isApprovedPayment", () => {
  it("counts only Paid / Success (case-insensitive)", () => {
    expect(isApprovedPayment("Paid")).toBe(true);
    expect(isApprovedPayment("success")).toBe(true);
    expect(isApprovedPayment("SUCCESS")).toBe(true);
  });

  it("excludes pending, rejected, unknown, and blank", () => {
    expect(isApprovedPayment("pending_verification")).toBe(false);
    expect(isApprovedPayment("rejected")).toBe(false);
    expect(isApprovedPayment("")).toBe(false);
    expect(isApprovedPayment(null)).toBe(false);
    expect(isApprovedPayment(undefined)).toBe(false);
  });
});

describe("sumApprovedPayments", () => {
  it("sums only approved rows and tolerates string/null amounts", () => {
    const rows = [
      { amount: 1000, status: "Success" },
      { amount: "500", status: "Paid" },
      { amount: 999, status: "pending_verification" }, // excluded
      { amount: 250, status: "rejected" }, // excluded
      { amount: null, status: "Success" }, // counts as 0
    ];
    expect(sumApprovedPayments(rows)).toBe(1500);
  });

  it("returns 0 for an empty list", () => {
    expect(sumApprovedPayments([])).toBe(0);
  });
});
