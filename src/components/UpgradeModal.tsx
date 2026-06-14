import { Link } from "@tanstack/react-router";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Lock, X } from "lucide-react";
import { PLANS, type PlanTier } from "@/lib/plans";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  /** Minimum tier required for the feature the user tried to open. */
  requiredTier: PlanTier;
  /** Human label for the gated feature, e.g. "Leaderboard". */
  featureLabel: string;
}

/**
 * Shown when a user clicks a feature their plan doesn't include. Routes to the
 * in-app Billing & Plans tab rather than navigating to the locked feature.
 */
export function UpgradeModal({ open, onClose, requiredTier, featureLabel }: UpgradeModalProps) {
  const planName = PLANS[requiredTier].name;

  return (
    <AnimatePresence>
      {open && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md rounded-[2rem] border border-slate-200 bg-white p-8 text-center shadow-2xl"
          >
            <button
              onClick={onClose}
              aria-label="Close"
              className="absolute right-5 top-5 text-slate-400 transition-colors hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
              <Crown className="h-8 w-8 text-primary" />
            </div>

            <h2 className="text-2xl font-bold tracking-tight text-slate-900">Upgrade to {planName}</h2>
            <p className="mt-2 text-sm font-medium text-slate-500">
              {featureLabel} is a {planName} feature. Upgrade your plan to unlock it.
            </p>

            <Link
              to="/dashboard"
              search={{ tab: "Settings", section: "Billing & Plans" } as never}
              onClick={onClose}
              className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-6 py-4 text-lg font-bold text-white shadow-glow transition-all hover:shadow-primary/40"
            >
              <Lock className="h-4 w-4" />
              Upgrade to {planName}
            </Link>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
