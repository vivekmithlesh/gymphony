/**
 * Backwards-compatible permission helpers layered on top of the centralized
 * plan config (src/lib/plans.ts — the single source of truth).
 *
 * Existing callers pass a plan *string* (legacy 'Free'/'Pro' or a new tier
 * name). `hasAccess` normalizes that string to a tier and checks the feature
 * against the central config. For trial/expiry-aware checks, prefer
 * `subscriptionHasFeature` / `resolveSubscription` from '@/lib/plans'.
 */
import {
  PLANS,
  normalizeTier,
  tierHasFeature,
  type Feature,
  type PlanTier,
} from "@/lib/plans";

export type PlanType = PlanTier;

/** Retained for any code importing the old constant. */
export const PRO_FEATURES = [
  "unlimited_members",
  "auto_reminders",
  "attendance_alerts",
  "advanced_analytics",
  "city_discovery",
  "public_profile",
  "whatsapp_support",
] as const;

export type FeatureName = Feature;

/**
 * Does a plan (string or tier) grant access to a feature?
 * `null` feature = always allowed (baseline capability).
 */
export const hasAccess = (
  planType: string | undefined | null,
  feature: FeatureName | null
): boolean => {
  if (!feature) return true;
  return tierHasFeature(normalizeTier(planType), feature);
};

/**
 * Member-record limits, sourced from the central plan config.
 * FREE_MEMBER_LIMIT is kept for back-compat and equals the Starter cap.
 */
export const LIMITS = {
  FREE_MEMBER_LIMIT: PLANS.starter.memberLimit,
  STARTER_MEMBER_LIMIT: PLANS.starter.memberLimit,
  GROWTH_MEMBER_LIMIT: PLANS.growth.memberLimit,
  PRO_MEMBER_LIMIT: PLANS.pro.memberLimit,
};

export {
  resolveSubscription,
  subscriptionHasFeature,
  memberLimitFor,
  tierForFeature,
  nextTier,
} from "@/lib/plans";
