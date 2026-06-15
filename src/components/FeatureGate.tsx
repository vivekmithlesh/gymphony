import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "@tanstack/react-router";
import { Crown, Lock, X, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlanAccess } from "@/lib/usePlanAccess";
import {
  PLANS,
  planAllows,
  requiredTierFor,
  type AppFeature,
  type SubscriptionLike,
} from "@/lib/plans";

interface FeatureGateProps {
  /** Central app feature this surface is gated behind (the ONLY source of truth). */
  feature: AppFeature;
  /** Human label shown in the lock badge / upgrade modal, e.g. "AI Retention Engine". */
  label: string;
  /**
   * Optional pre-resolved gym_settings row. When provided, access is computed
   * from it (no extra fetch) — use this when the parent already holds the row.
   * When omitted, the gym_settings row is fetched via usePlanAccess.
   */
  subscription?: SubscriptionLike | null;
  children: React.ReactNode;
  className?: string;
  badgePosition?: "top-right" | "inline";
}

/**
 * Inline feature gate — the single, SSOT-backed replacement for the legacy
 * `FeatureLock` (which hard-coded `isPro = true`) and `ProFeatureGuard` (which
 * string-compared `plan_type === 'Pro'`). Access is resolved EXCLUSIVELY through
 * `usePlanAccess().hasAccess(feature)`, which is trial/expiry-aware and reads the
 * same `FEATURE_MIN_TIER` map as the route guard, the sidebar nav, and the
 * server. There is no client-side plan write anywhere in this component — the
 * upgrade CTA only routes to Settings → Billing, where the verified billing flow
 * lives. This guarantees the sidebar, dashboard tiles and feature pages can never
 * disagree about whether a feature is locked.
 */
export const FeatureGate: React.FC<FeatureGateProps> = ({
  feature,
  label,
  subscription,
  children,
  className = "",
  badgePosition = "top-right",
}) => {
  const navigate = useNavigate();
  const hasOwnRow = subscription !== undefined;
  const access = usePlanAccess({ enabled: !hasOwnRow });
  const isLoading = hasOwnRow ? false : access.isLoading;
  const allowed = hasOwnRow ? planAllows(subscription, feature) : access.hasAccess(feature);
  const [showPricing, setShowPricing] = React.useState(false);

  // While the plan is still resolving, render the children unlocked rather than
  // flashing a lock on a feature the user may well be entitled to. The real
  // security boundary for the underlying data is server-side (RLS / RPC), so a
  // sub-second optimistic render here cannot grant access to protected data.
  const locked = !isLoading && !allowed;

  if (!locked) {
    return <>{children}</>;
  }

  const tier = requiredTierFor(feature);
  const planName = PLANS[tier].name;

  const goToBilling = () => {
    setShowPricing(false);
    navigate({
      to: "/dashboard",
      search: (prev: Record<string, unknown>) => ({
        ...prev,
        tab: "Settings",
        section: "Billing & Plans",
      }),
    });
    // Some dashboard layouts track the active tab in local state as well.
    window.dispatchEvent(new CustomEvent("switchTab", { detail: "Settings" }));
  };

  return (
    <>
      <div
        className={`relative group cursor-pointer ${className}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setShowPricing(true);
        }}
      >
        {badgePosition === "top-right" && (
          <div className="absolute -top-1 -right-1 z-20">
            <div className="bg-gradient-brand text-white p-1 rounded-lg shadow-lg">
              <Crown className="h-3 w-3" />
            </div>
          </div>
        )}

        <div className="pointer-events-none opacity-60 grayscale-[0.5]">{children}</div>

        <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/10 rounded-xl">
          <div className="bg-white/90 backdrop-blur-sm px-3 py-1.5 rounded-full shadow-xl flex items-center gap-2 border border-primary/20">
            <Lock className="h-3 w-3 text-primary" />
            <span className="text-[10px] font-bold text-slate-900 uppercase tracking-widest">
              {planName} feature
            </span>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showPricing && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-6 bg-slate-900/90 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md bg-white rounded-[3rem] overflow-hidden shadow-2xl relative border border-white/20"
            >
              <div className="absolute top-6 right-6">
                <button
                  onClick={() => setShowPricing(false)}
                  className="text-slate-400 hover:text-slate-600 transition-colors p-2"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="p-10 space-y-8">
                <div className="text-center space-y-4">
                  <div className="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-2">
                    <Crown className="h-10 w-10 text-primary animate-pulse" />
                  </div>
                  <h2 className="text-3xl font-bold text-slate-900 tracking-tight">
                    {planName} feature locked
                  </h2>
                  <p className="text-slate-500 font-medium pt-2">
                    Upgrade to {planName} to unlock{" "}
                    <span className="text-primary font-bold">{label}</span>.
                  </p>
                </div>

                <Button
                  onClick={goToBilling}
                  className="w-full h-16 rounded-2xl bg-gradient-brand text-white font-bold text-lg shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
                >
                  <Sparkles className="h-5 w-5" />
                  View plans & upgrade
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};
