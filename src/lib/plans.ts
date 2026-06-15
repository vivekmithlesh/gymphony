/**
 * Centralized plan configuration — the SINGLE SOURCE OF TRUTH for Gymphony's
 * SaaS subscription tiers. Every UI surface and access check (pricing page,
 * dashboard usage meter, feature gates, member-limit enforcement, Settings
 * billing) must read from this file. No plan limits, prices or feature flags
 * may be hardcoded anywhere else.
 *
 * The owner's subscription lives on the `gym_settings` row
 * (plan_tier / plan_status / trial_ends_at / expiry_date / billing_cycle).
 * Member-side membership (profiles.subscription_*) is a DIFFERENT concept and
 * is NOT governed by this file.
 */

export type PlanTier = "starter" | "growth" | "pro";
export type PlanStatus = "trial" | "active" | "expired" | "inactive";
export type BillingCycle = "monthly" | "yearly";

/** Length of the free trial, in days. */
export const TRIAL_DAYS = 7;

/** During an active trial the gym gets full Growth-tier access. */
export const TRIAL_TIER: PlanTier = "growth";

/** Yearly billing charges 10 months → 2 months free. */
export const YEARLY_MONTHS_CHARGED = 10;

/**
 * Every gateable capability in the app. Baseline features available on ALL
 * tiers (member management, QR attendance, kiosk mode, attendance tracking,
 * membership plans, activity logs, basic revenue tracking) are intentionally
 * NOT listed here — they are never gated.
 */
export type Feature =
  | "unlimited_members"
  | "auto_reminders"
  | "attendance_alerts"
  | "advanced_analytics" // Revenue Analytics page
  | "pending_dues"
  | "attendance_insights"
  | "leaderboards"
  | "advanced_reporting"
  | "city_discovery"
  | "public_profile"
  | "whatsapp_support"
  | "multi_staff"
  | "ai_features";

export interface PlanDef {
  id: PlanTier;
  name: string;
  tagline: string;
  priceMonthly: number; // INR / month
  /** Effective per-month price when billed yearly (priceMonthly * 10 / 12). */
  priceYearlyPerMonth: number;
  /** Total charged once per year. */
  priceYearlyTotal: number;
  /** Hard cap on member records. Infinity = unlimited. */
  memberLimit: number;
  popular?: boolean;
  /** Cumulative gated features unlocked AT this tier (higher tiers inherit). */
  features: Feature[];
  /** Marketing bullets for the pricing card / billing UI. */
  highlights: string[];
}

const yearly = (monthly: number) => ({
  priceYearlyTotal: monthly * YEARLY_MONTHS_CHARGED,
  priceYearlyPerMonth: Math.round((monthly * YEARLY_MONTHS_CHARGED) / 12),
});

const GROWTH_FEATURES: Feature[] = [
  "advanced_analytics",
  "pending_dues",
  "attendance_insights",
  "leaderboards",
  "advanced_reporting",
  "auto_reminders",
  "attendance_alerts",
  "city_discovery",
  "public_profile",
  "whatsapp_support",
];

const PRO_ONLY_FEATURES: Feature[] = [
  "unlimited_members",
  "multi_staff",
  "ai_features",
];

/** Ordered low → high. Tier index drives "does X include feature of Y". */
export const PLAN_ORDER: PlanTier[] = ["starter", "growth", "pro"];

export const PLANS: Record<PlanTier, PlanDef> = {
  starter: {
    id: "starter",
    name: "Starter",
    tagline: "Everything you need to ditch the register.",
    priceMonthly: 999,
    ...yearly(999),
    memberLimit: 100,
    features: [], // baseline only
    highlights: [
      "Up to 100 members",
      "Member management",
      "QR attendance & kiosk mode",
      "Attendance tracking",
      "Membership plans",
      "Activity logs",
      "Basic revenue tracking",
    ],
  },
  growth: {
    id: "growth",
    name: "Growth",
    tagline: "Protect revenue and grow on autopilot.",
    priceMonthly: 1999,
    ...yearly(1999),
    memberLimit: 500,
    popular: true,
    features: GROWTH_FEATURES,
    highlights: [
      "Up to 500 members",
      "Everything in Starter",
      "Revenue analytics",
      "Pending dues tracking",
      "Attendance insights",
      "Leaderboards",
      "Advanced reporting",
      "Priority support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "Scale without limits.",
    priceMonthly: 3999,
    ...yearly(3999),
    memberLimit: Infinity,
    features: [...GROWTH_FEATURES, ...PRO_ONLY_FEATURES],
    highlights: [
      "Unlimited members",
      "Everything in Growth",
      "Multi-staff support",
      "Advanced analytics",
      "Future AI features",
      "Premium support",
    ],
  },
};

export const PLAN_LIST: PlanDef[] = PLAN_ORDER.map((t) => PLANS[t]);

/** Map any stored/legacy plan string onto a known tier. */
export function normalizeTier(raw: string | null | undefined): PlanTier {
  const v = (raw || "").toString().trim().toLowerCase();
  if (v === "pro") return "pro";
  if (v === "growth") return "growth";
  if (v === "starter") return "starter";
  // Legacy values: the old model only had 'Free' and 'Pro'.
  if (v === "free" || v === "trial" || v === "") return "starter";
  return "starter";
}

/** Shape of the subscription fields we read off a gym_settings row. */
export interface SubscriptionLike {
  plan_tier?: string | null;
  plan_status?: string | null;
  trial_ends_at?: string | null;
  expiry_date?: string | null;
  billing_cycle?: string | null;
  /** Legacy column from the old Free/Pro model. */
  plan_type?: string | null;
}

export interface ResolvedSubscription {
  /** Effective tier the gym should be treated as RIGHT NOW. */
  tier: PlanTier;
  /** The tier they have paid for / are nominally on (ignores trial boost). */
  baseTier: PlanTier;
  status: PlanStatus;
  isTrial: boolean;
  trialDaysLeft: number;
  trialEndsAt: Date | null;
  /** True once a trial has ended with no paid plan. */
  trialExpired: boolean;
  billingCycle: BillingCycle;
  memberLimit: number;
  plan: PlanDef;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const parseDate = (v: string | null | undefined): number =>
  v ? Date.parse(v) : NaN;

/**
 * Resolve a gym_settings row into the subscription the rest of the app should
 * obey. Handles trial boosts and expiry downgrades centrally so no caller has
 * to reason about dates.
 */
export function resolveSubscription(
  s: SubscriptionLike | null | undefined
): ResolvedSubscription {
  const now = Date.now();
  const baseTier = normalizeTier(s?.plan_tier ?? s?.plan_type);
  const rawStatus = (s?.plan_status || "").toString().trim().toLowerCase();

  const trialEndsMs = parseDate(s?.trial_ends_at);
  const expiryMs = parseDate(s?.expiry_date);
  const billingCycle: BillingCycle =
    (s?.billing_cycle || "").toLowerCase() === "yearly" ? "yearly" : "monthly";

  const hasTrialWindow = !Number.isNaN(trialEndsMs);
  const trialActive =
    (rawStatus === "trial" || (hasTrialWindow && rawStatus !== "active")) &&
    hasTrialWindow &&
    trialEndsMs > now;
  const trialExpired =
    (rawStatus === "trial" || hasTrialWindow) &&
    hasTrialWindow &&
    trialEndsMs <= now &&
    rawStatus !== "active";

  // Paid subscription is considered lapsed once expiry_date passes.
  const paidExpired =
    rawStatus === "active" && !Number.isNaN(expiryMs) && expiryMs <= now;

  let tier: PlanTier;
  let status: PlanStatus;

  if (trialActive) {
    tier = TRIAL_TIER;
    status = "trial";
  } else if (paidExpired || trialExpired) {
    // Graceful downgrade to the always-usable Starter tier.
    tier = "starter";
    status = "expired";
  } else if (rawStatus === "active") {
    tier = baseTier;
    status = "active";
  } else {
    // No status yet (fresh row) — treat as Starter baseline.
    tier = baseTier;
    status = "inactive";
  }

  const trialDaysLeft = trialActive
    ? Math.max(0, Math.ceil((trialEndsMs - now) / DAY_MS))
    : 0;

  return {
    tier,
    baseTier,
    status,
    isTrial: trialActive,
    trialDaysLeft,
    trialEndsAt: hasTrialWindow ? new Date(trialEndsMs) : null,
    trialExpired,
    billingCycle,
    memberLimit: PLANS[tier].memberLimit,
    plan: PLANS[tier],
  };
}

/** Does the given tier (or resolved subscription) unlock a feature? */
export function tierHasFeature(tier: PlanTier, feature: Feature): boolean {
  return PLANS[tier].features.includes(feature);
}

export function subscriptionHasFeature(
  s: SubscriptionLike | null | undefined,
  feature: Feature
): boolean {
  return tierHasFeature(resolveSubscription(s).tier, feature);
}

/** Numeric member cap for a resolved subscription. */
export function memberLimitFor(s: SubscriptionLike | null | undefined): number {
  return resolveSubscription(s).memberLimit;
}

/** The next tier up, for "Upgrade to X" CTAs. Pro has no upsell. */
export function nextTier(tier: PlanTier): PlanTier | null {
  const i = PLAN_ORDER.indexOf(tier);
  return i >= 0 && i < PLAN_ORDER.length - 1 ? PLAN_ORDER[i + 1] : null;
}

/** Smallest tier that unlocks a feature — for "Upgrade to X to use Y". */
export function tierForFeature(feature: Feature): PlanTier {
  return PLAN_ORDER.find((t) => tierHasFeature(t, feature)) ?? "pro";
}

export function formatINR(n: number): string {
  return "₹" + Math.round(n).toLocaleString("en-IN");
}

// ===========================================================================
// Feature → minimum-tier ACCESS MAP — the single source of truth for
// route/nav/server gating. Plan ranks: starter=1, growth=2, pro=3. A plan
// unlocks a feature when its rank >= the feature's required rank.
//
// This is intentionally a separate, explicit namespace from the marketing
// `Feature` flags above so gating reads the same way on the client, the route
// guard, and (mirrored) the server.
// ===========================================================================

export const PLAN_RANK: Record<PlanTier, number> = {
  starter: 1,
  growth: 2,
  pro: 3,
};

export type AppFeature =
  // starter (rank 1)
  | "dashboard"
  | "members"
  | "attendance"
  | "kiosk"
  | "membership_plans"
  | "activity_logs"
  | "basic_revenue"
  // growth (rank 2)
  | "revenue_analytics"
  | "pending_dues"
  | "attendance_insights"
  | "leaderboard"
  | "advanced_reporting"
  | "inventory_management"
  | "whatsapp_reminders"
  // pro (rank 3)
  | "multi_staff"
  | "advanced_analytics"
  | "multi_branch"
  | "ai_features";

export const FEATURE_MIN_TIER: Record<AppFeature, PlanTier> = {
  dashboard: "starter",
  members: "starter",
  attendance: "starter",
  kiosk: "starter",
  membership_plans: "starter",
  activity_logs: "starter",
  basic_revenue: "starter",

  revenue_analytics: "growth",
  pending_dues: "growth",
  attendance_insights: "growth",
  leaderboard: "growth",
  advanced_reporting: "growth",
  inventory_management: "growth",
  whatsapp_reminders: "growth",

  multi_staff: "pro",
  advanced_analytics: "pro",
  multi_branch: "pro",
  ai_features: "pro",
};

/** Minimum tier that unlocks an app feature (drives "Upgrade to X" copy). */
export function requiredTierFor(feature: AppFeature): PlanTier {
  return FEATURE_MIN_TIER[feature];
}

/** Pure rank comparison: does a tier unlock this app feature? */
export function tierUnlocks(tier: PlanTier, feature: AppFeature): boolean {
  return PLAN_RANK[tier] >= PLAN_RANK[FEATURE_MIN_TIER[feature]];
}

/** Trial/expiry-aware feature access for a gym_settings row. */
export function planAllows(
  s: SubscriptionLike | null | undefined,
  feature: AppFeature
): boolean {
  return tierUnlocks(resolveSubscription(s).tier, feature);
}

// ---------------------------------------------------------------------------
// Pro honesty: Pro's headline features are not built yet, so we must never let
// anyone PAY for them. These exact highlight strings (from PLANS.pro.highlights)
// render a "Coming soon" badge, and the Pro CTA becomes "Join waitlist".
// ---------------------------------------------------------------------------
export const COMING_SOON_HIGHLIGHTS: ReadonlySet<string> = new Set([
  "Multi-staff support",
  "Advanced analytics",
  "Future AI features",
]);

/** While true, Pro cannot be purchased (waitlist only). */
export const PRO_IS_WAITLIST = true;

export function isComingSoonHighlight(label: string): boolean {
  return COMING_SOON_HIGHLIGHTS.has(label);
}
