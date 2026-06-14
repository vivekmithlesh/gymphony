import { useEffect, useState } from "react";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  resolveSubscription,
  planAllows,
  requiredTierFor,
  type SubscriptionLike,
  type ResolvedSubscription,
  type AppFeature,
  type PlanTier,
} from "@/lib/plans";

export interface PlanAccess {
  isLoading: boolean;
  subscription: ResolvedSubscription;
  tier: PlanTier;
  /** Compares the CURRENT plan's rank to the feature's required rank. */
  hasAccess: (feature: AppFeature) => boolean;
  requiredTierFor: (feature: AppFeature) => PlanTier;
}

/**
 * Resolves the signed-in owner's subscription (from gym_settings) and exposes a
 * trial/expiry-aware `hasAccess(feature)` bound to the central FEATURE_MIN_TIER
 * map. Use this in components that don't already hold a gym_settings row (route
 * guards, the shared DashboardLayout nav). Components that already have
 * gym_settings can call `planAllows(gymSettings, feature)` directly instead.
 */
export function usePlanAccess(): PlanAccess {
  const { user } = useAuth();
  const [sub, setSub] = useState<SubscriptionLike | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!user?.id) {
        setIsLoading(false);
        return;
      }
      // select('*') so missing subscription columns degrade to Starter rather
      // than throwing if the plans migration hasn't been applied yet.
      const { data } = await supabase
        .from("gym_settings")
        .select("*")
        .eq("gym_owner_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setSub((data as SubscriptionLike) ?? {});
        setIsLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const subscription = resolveSubscription(sub);

  return {
    isLoading,
    subscription,
    tier: subscription.tier,
    hasAccess: (feature) => planAllows(sub, feature),
    requiredTierFor,
  };
}
