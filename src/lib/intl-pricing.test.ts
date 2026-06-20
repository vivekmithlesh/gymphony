import { describe, it, expect } from "vitest";
import {
  COUNTRIES,
  COUNTRY_TIER,
  INTL_PRICES,
  isIndia,
  tierForCountry,
  currencyForCountry,
  intlMonthlyPrice,
  formatUSD,
  priceView,
  type CountryTier,
} from "@/lib/intl-pricing";
import { PLANS, type PlanTier } from "@/lib/plans";

const TIER1 = ["US", "GB", "CA", "AU", "DE", "FR", "NL", "CH", "AE", "SG"];
const TIER2 = ["ES", "IT", "PT", "PL", "CZ", "SA", "ZA"];
const TIER3 = ["PK", "BD", "NP", "LK", "PH", "ID", "VN", "EG", "NG", "KE"];

describe("tierForCountry", () => {
  it("maps every listed country to the correct purchasing-power tier", () => {
    TIER1.forEach((c) => expect(tierForCountry(c)).toBe(1));
    TIER2.forEach((c) => expect(tierForCountry(c)).toBe(2));
    TIER3.forEach((c) => expect(tierForCountry(c)).toBe(3));
  });

  it("is case-insensitive and trims input", () => {
    expect(tierForCountry("us")).toBe(1);
    expect(tierForCountry("  za  ")).toBe(2);
  });

  it("falls back to Tier 1 for unlisted countries (never underprice)", () => {
    expect(tierForCountry("XX")).toBe(1);
    expect(tierForCountry("")).toBe(1);
    expect(tierForCountry(undefined)).toBe(1);
  });
});

describe("isIndia / currencyForCountry", () => {
  it("recognises India and uses INR; everyone else USD", () => {
    expect(isIndia("IN")).toBe(true);
    expect(isIndia("in")).toBe(true);
    expect(isIndia("US")).toBe(false);
    expect(currencyForCountry("IN")).toBe("INR");
    expect(currencyForCountry("US")).toBe("USD");
    expect(currencyForCountry("XX")).toBe("USD");
  });
});

describe("INTL_PRICES table", () => {
  it("matches the agreed purchasing-power pricing", () => {
    expect(INTL_PRICES[1]).toEqual({ starter: 29, growth: 50, pro: 99 });
    expect(INTL_PRICES[2]).toEqual({ starter: 19, growth: 39, pro: 79 });
    expect(INTL_PRICES[3]).toEqual({ starter: 9, growth: 19, pro: 49 });
  });

  it("keeps every international price under $100", () => {
    ([1, 2, 3] as CountryTier[]).forEach((t) =>
      (["starter", "growth", "pro"] as PlanTier[]).forEach((p) =>
        expect(INTL_PRICES[t][p]).toBeLessThan(100)
      )
    );
  });
});

describe("intlMonthlyPrice", () => {
  it("resolves a country to its tier price", () => {
    expect(intlMonthlyPrice("US", "growth")).toBe(50);
    expect(intlMonthlyPrice("ES", "pro")).toBe(79);
    expect(intlMonthlyPrice("PK", "starter")).toBe(9);
    expect(intlMonthlyPrice("XX", "pro")).toBe(99); // unlisted → Tier 1
  });
});

describe("formatUSD", () => {
  it("formats whole-dollar amounts", () => {
    expect(formatUSD(29)).toBe("$29");
    expect(formatUSD(1490)).toBe("$1,490");
  });
});

describe("priceView", () => {
  it("uses INR + plans.ts for India", () => {
    const v = priceView("IN", "growth", "monthly");
    expect(v.currency).toBe("INR");
    expect(v.perMonth).toBe(PLANS.growth.priceMonthly);
    expect(v.perMonthLabel.startsWith("₹")).toBe(true);
  });

  it("uses USD tier pricing for international monthly", () => {
    const v = priceView("US", "growth", "monthly");
    expect(v.currency).toBe("USD");
    expect(v.perMonth).toBe(50);
    expect(v.total).toBe(50);
    expect(v.perMonthLabel).toBe("$50");
  });

  it("charges 10 months for yearly (2 months free) internationally", () => {
    const v = priceView("US", "growth", "yearly");
    expect(v.total).toBe(500); // 50 * 10
    expect(v.perMonth).toBe(Math.round(500 / 12)); // effective per-month
  });
});

describe("COUNTRIES list integrity", () => {
  it("lists India plus every tiered country with unique codes", () => {
    const codes = COUNTRIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes).toContain("IN");
    [...TIER1, ...TIER2, ...TIER3].forEach((c) => expect(codes).toContain(c));
  });

  it("every non-India listed country has a tier mapping", () => {
    COUNTRIES.filter((c) => c.code !== "IN").forEach((c) =>
      expect(COUNTRY_TIER[c.code]).toBeDefined()
    );
  });
});
