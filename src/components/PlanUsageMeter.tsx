import { motion } from "framer-motion";
import { Users, Crown, Sparkles } from "lucide-react";
import {
  resolveSubscription,
  nextTier,
  PLANS,
  formatINR,
  type SubscriptionLike,
} from "@/lib/plans";

interface PlanUsageMeterProps {
  /** The owner's gym_settings row (plan_tier / plan_status / trial_ends_at …). */
  gymSettings: SubscriptionLike | null | undefined;
  /** Current member-record count for this gym. */
  memberCount: number;
  /** Called when the owner clicks "Upgrade" (e.g. switch to the Billing tab). */
  onUpgrade?: () => void;
  className?: string;
}

/**
 * Subscription-aware usage meter. Reads the real plan from gym_settings and the
 * real member count — no hardcoded limits. Shows "78 / 100 Members", a progress
 * bar that turns amber/red as the cap approaches, the trial countdown, and a
 * contextual upgrade CTA.
 */
export function PlanUsageMeter({
  gymSettings,
  memberCount,
  onUpgrade,
  className = "",
}: PlanUsageMeterProps) {
  const sub = resolveSubscription(gymSettings);
  const limit = sub.memberLimit;
  const unlimited = !Number.isFinite(limit);
  const pct = unlimited ? 0 : Math.min(100, Math.round((memberCount / limit) * 100));
  const upsell = nextTier(sub.tier);

  const barColor =
    pct >= 100 ? "bg-red-500" : pct >= 85 ? "bg-amber-500" : "bg-gradient-brand";

  return (
    <div
      className={`rounded-3xl border border-purple-100 bg-white p-6 shadow-sm ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Crown className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-slate-900">
              {sub.plan.name} plan
              {sub.isTrial && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">
                  Trial · {sub.trialDaysLeft}d left
                </span>
              )}
              {sub.status === "expired" && (
                <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-600">
                  Expired
                </span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {unlimited
                ? "Unlimited members"
                : `${memberCount.toLocaleString("en-IN")} / ${limit.toLocaleString("en-IN")} members used`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-slate-600">
          <Users className="h-4 w-4" />
          <span className="text-lg font-bold">
            {unlimited ? "∞" : memberCount.toLocaleString("en-IN")}
          </span>
        </div>
      </div>

      {!unlimited && (
        <div className="mt-4">
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className={`h-full rounded-full ${barColor}`}
            />
          </div>
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-slate-400">
              {pct}% used
            </span>
            {pct >= 85 && upsell && (
              <span className="text-[11px] font-bold text-amber-600">
                {pct >= 100 ? "Limit reached" : "Almost full"}
              </span>
            )}
          </div>
        </div>
      )}

      {upsell && (pct >= 85 || sub.isTrial || sub.status === "expired") && (
        <button
          onClick={onUpgrade}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-brand px-4 py-3 text-sm font-bold text-white shadow-glow transition-all hover:-translate-y-0.5"
        >
          <Sparkles className="h-4 w-4" />
          Upgrade to {PLANS[upsell].name} · {formatINR(PLANS[upsell].priceMonthly)}/mo
        </button>
      )}
    </div>
  );
}
