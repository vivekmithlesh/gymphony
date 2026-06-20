/**
 * International (Payoneer) pricing — the SINGLE SOURCE OF TRUTH for purchasing-
 * power-adjusted USD plan prices sold to owners OUTSIDE India.
 *
 * India keeps its own INR pricing in src/lib/plans.ts (PLANS[*].priceMonthly) and
 * its own UPI payment flow — this file never touches it. Every international price
 * here is mirrored server-side in app_create_intl_payment (migration 20260705) so
 * the backend, not the client, decides the amount charged.
 *
 * Plan tiers (starter / growth / pro) and the yearly discount (10 months charged)
 * are owned by plans.ts; we only add the country → tier → USD price mapping.
 */

import {
  PLANS,
  formatINR,
  YEARLY_MONTHS_CHARGED,
  type PlanTier,
  type BillingCycle,
} from "@/lib/plans";

export type CountryTier = 1 | 2 | 3;
export type Currency = "INR" | "USD";

/** India is special-cased everywhere: INR pricing + the existing UPI flow. */
export const INDIA_CODE = "IN";

/** Unlisted international countries fall back to Tier 1 (highest) — never underprice. */
export const DEFAULT_COUNTRY_TIER: CountryTier = 1;

export interface Country {
  /** ISO 3166-1 alpha-2 (uppercase). */
  code: string;
  name: string;
  flag: string;
}

/**
 * Countries offered in the billing-country selector. India first (its own flow),
 * then the explicitly-tiered markets. `tierForCountry` falls back to Tier 1 for
 * any code not listed here, so this list can grow without code changes.
 */
export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", flag: "🇮🇳" },
  // Tier 1
  { code: "US", name: "United States", flag: "🇺🇸" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧" },
  { code: "CA", name: "Canada", flag: "🇨🇦" },
  { code: "AU", name: "Australia", flag: "🇦🇺" },
  { code: "DE", name: "Germany", flag: "🇩🇪" },
  { code: "FR", name: "France", flag: "🇫🇷" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪" },
  { code: "SG", name: "Singapore", flag: "🇸🇬" },
  // Tier 2
  { code: "ES", name: "Spain", flag: "🇪🇸" },
  { code: "IT", name: "Italy", flag: "🇮🇹" },
  { code: "PT", name: "Portugal", flag: "🇵🇹" },
  { code: "PL", name: "Poland", flag: "🇵🇱" },
  { code: "CZ", name: "Czech Republic", flag: "🇨🇿" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦" },
  { code: "ZA", name: "South Africa", flag: "🇿🇦" },
  // Tier 3
  { code: "PK", name: "Pakistan", flag: "🇵🇰" },
  { code: "BD", name: "Bangladesh", flag: "🇧🇩" },
  { code: "NP", name: "Nepal", flag: "🇳🇵" },
  { code: "LK", name: "Sri Lanka", flag: "🇱🇰" },
  { code: "PH", name: "Philippines", flag: "🇵🇭" },
  { code: "ID", name: "Indonesia", flag: "🇮🇩" },
  { code: "VN", name: "Vietnam", flag: "🇻🇳" },
  { code: "EG", name: "Egypt", flag: "🇪🇬" },
  { code: "NG", name: "Nigeria", flag: "🇳🇬" },
  { code: "KE", name: "Kenya", flag: "🇰🇪" },
];

/** Country → purchasing-power tier. India is omitted (it isn't an intl tier). */
export const COUNTRY_TIER: Record<string, CountryTier> = {
  // Tier 1
  US: 1, GB: 1, CA: 1, AU: 1, DE: 1, FR: 1, NL: 1, CH: 1, AE: 1, SG: 1,
  // Tier 2
  ES: 2, IT: 2, PT: 2, PL: 2, CZ: 2, SA: 2, ZA: 2,
  // Tier 3
  PK: 3, BD: 3, NP: 3, LK: 3, PH: 3, ID: 3, VN: 3, EG: 3, NG: 3, KE: 3,
};

/** USD per-month price by country tier and plan. Mirrored in SQL (20260705). */
export const INTL_PRICES: Record<CountryTier, Record<PlanTier, number>> = {
  1: { starter: 29, growth: 50, pro: 99 },
  2: { starter: 19, growth: 39, pro: 79 },
  3: { starter: 9, growth: 19, pro: 49 },
};

export function normalizeCode(code: string | null | undefined): string {
  return (code || "").toString().trim().toUpperCase();
}

export function isIndia(code: string | null | undefined): boolean {
  return normalizeCode(code) === INDIA_CODE;
}

/** Purchasing-power tier for a country (unlisted international → Tier 1). */
export function tierForCountry(code: string | null | undefined): CountryTier {
  return COUNTRY_TIER[normalizeCode(code)] ?? DEFAULT_COUNTRY_TIER;
}

export function currencyForCountry(code: string | null | undefined): Currency {
  return isIndia(code) ? "INR" : "USD";
}

export function countryName(code: string | null | undefined): string {
  const c = normalizeCode(code);
  return COUNTRIES.find((x) => x.code === c)?.name ?? c;
}

/** USD per-month price for a plan in a given (non-India) country. */
export function intlMonthlyPrice(code: string | null | undefined, plan: PlanTier): number {
  return INTL_PRICES[tierForCountry(code)][plan];
}

export function formatUSD(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

export interface PriceView {
  currency: Currency;
  /** Figure to headline as "/ month" (yearly shows the effective per-month). */
  perMonth: number;
  /** Total charged for the chosen cycle (monthly = perMonth; yearly = ×10). */
  total: number;
  perMonthLabel: string;
  totalLabel: string;
}

/**
 * Resolve the price to DISPLAY for a country + plan + cycle. India reads the INR
 * SSOT (plans.ts); everyone else reads the USD tier table. Yearly mirrors India's
 * "2 months free" everywhere (YEARLY_MONTHS_CHARGED = 10).
 */
export function priceView(
  code: string | null | undefined,
  plan: PlanTier,
  cycle: BillingCycle
): PriceView {
  if (isIndia(code)) {
    const def = PLANS[plan];
    const perMonth = cycle === "yearly" ? def.priceYearlyPerMonth : def.priceMonthly;
    const total = cycle === "yearly" ? def.priceYearlyTotal : def.priceMonthly;
    return {
      currency: "INR",
      perMonth,
      total,
      perMonthLabel: formatINR(perMonth),
      totalLabel: formatINR(total),
    };
  }

  const monthly = intlMonthlyPrice(code, plan);
  const yearlyTotal = monthly * YEARLY_MONTHS_CHARGED;
  const perMonth = cycle === "yearly" ? Math.round(yearlyTotal / 12) : monthly;
  const total = cycle === "yearly" ? yearlyTotal : monthly;
  return {
    currency: "USD",
    perMonth,
    total,
    perMonthLabel: formatUSD(perMonth),
    totalLabel: formatUSD(total),
  };
}
