import React from "react";
import { Link } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Crown, Lock } from "lucide-react";
import { usePlanAccess } from "@/lib/usePlanAccess";
import { PLANS, requiredTierFor, type AppFeature } from "@/lib/plans";

interface FeatureRouteGuardProps {
  /** Central app feature this route is gated behind. */
  feature: AppFeature;
  /** Human label shown on the locked screen, e.g. "City Leaderboard". */
  featureLabel: string;
  children: React.ReactNode;
}

/**
 * Route-level gate. A direct URL to a feature above the owner's plan shows an
 * upgrade screen instead of rendering (and never lets the gated children mount,
 * so their data hooks never run). Trial/expiry-aware via usePlanAccess.
 *
 * NOTE: this is defence-in-depth for the UX. The real security boundary is the
 * server-side check in the data endpoint (e.g. the leaderboard RPC).
 */
export function FeatureRouteGuard({ feature, featureLabel, children }: FeatureRouteGuardProps) {
  const { isLoading, hasAccess } = usePlanAccess();

  if (isLoading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (hasAccess(feature)) {
    return <>{children}</>;
  }

  const tier = requiredTierFor(feature);
  const planName = PLANS[tier].name;

  return (
    <div className="flex min-h-[500px] w-full items-center justify-center p-6">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md space-y-6 rounded-[3rem] border border-slate-200 bg-white p-10 text-center shadow-2xl"
      >
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl bg-primary/10">
          <Crown className="h-10 w-10 animate-pulse text-primary" />
        </div>

        <div className="space-y-2">
          <h2 className="text-3xl font-bold tracking-tight text-slate-900">{featureLabel}</h2>
          <p className="font-medium text-slate-500">
            {featureLabel} is a {planName} feature. Upgrade your plan to unlock it.
          </p>
        </div>

        <Link
          to="/dashboard"
          search={{ tab: "Settings", section: "Billing & Plans" } as never}
          className="flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand text-xl font-bold text-white shadow-glow transition-all hover:shadow-primary/40"
        >
          <Lock className="h-4 w-4" />
          Upgrade to {planName}
        </Link>
      </motion.div>
    </div>
  );
}
