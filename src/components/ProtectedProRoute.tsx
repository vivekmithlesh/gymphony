import React from "react";
import { useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Crown, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePlanAccess } from "@/lib/usePlanAccess";
import { PLANS, type AppFeature } from "@/lib/plans";

interface ProtectedProRouteProps {
  /** Central app feature this page is gated behind — the ONLY source of truth. */
  feature: AppFeature;
  featureName: string;
  description: string;
  children: React.ReactNode;
}

/**
 * Page-level gate for a feature surface. Access is resolved through the shared,
 * trial/expiry-aware `usePlanAccess().hasAccess(feature)` so a page can never
 * disagree with the sidebar that links to it (the historical bug: the sidebar
 * unlocked Revenue/Inventory at Growth while this guard demanded Pro). No
 * client-side plan writes — the upgrade CTA only routes to Settings → Billing.
 */
export const ProtectedProRoute: React.FC<ProtectedProRouteProps> = ({
  feature,
  featureName,
  description,
  children,
}) => {
  const navigate = useNavigate();
  const { isLoading, hasAccess, requiredTierFor } = usePlanAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="h-8 w-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (hasAccess(feature)) {
    return <>{children}</>;
  }

  const planName = PLANS[requiredTierFor(feature)].name;

  return (
    <div className="relative min-h-[500px] w-full">
      {/* Blurred Background Mockup */}
      <div className="absolute inset-0 blur-md grayscale opacity-40 pointer-events-none select-none">
        {children}
      </div>

      {/* Lock Overlay */}
      <div className="absolute inset-0 z-50 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-md bg-white/90 backdrop-blur-xl border border-white/20 shadow-2xl rounded-[3rem] p-10 text-center space-y-6"
        >
          <div className="h-20 w-20 bg-primary/10 rounded-3xl flex items-center justify-center mx-auto mb-2">
            <Crown className="h-10 w-10 text-primary animate-pulse" />
          </div>

          <div className="space-y-2">
            <h2 className="text-3xl font-bold text-slate-900 tracking-tight">{featureName}</h2>
            <p className="text-slate-500 font-medium">{description}</p>
          </div>

          <div className="pt-4 space-y-4">
            <Button
              onClick={() => {
                navigate({
                  to: "/dashboard",
                  search: (prev: Record<string, unknown>) => ({
                    ...prev,
                    tab: "Settings",
                    section: "Billing & Plans",
                  }),
                });
                window.dispatchEvent(new CustomEvent("switchTab", { detail: "Settings" }));
              }}
              className="w-full h-16 rounded-2xl bg-gradient-brand text-white font-bold text-xl shadow-glow hover:shadow-primary/40 transition-all flex items-center justify-center gap-2"
            >
              Upgrade to {planName}
            </Button>
            <p className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest flex items-center justify-center gap-2">
              <Lock className="h-3 w-3" />
              Unlock this with the {planName} plan
            </p>
          </div>
        </motion.div>
      </div>
    </div>
  );
};
