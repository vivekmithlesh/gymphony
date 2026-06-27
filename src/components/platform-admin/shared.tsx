// Shared bits for the Platform Super Admin panel: consistent plan/status pills
// that resolve the SAME way the rest of the app does (trial boost + expiry
// downgrade) via src/lib/plans.ts, so the admin sees the live effective state.

import { resolveSubscription, normalizeTier, type SubscriptionLike } from "@/lib/plans";

const STATUS_STYLES: Record<string, string> = {
  trial: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  active: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  expired: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  inactive: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

const STATUS_LABEL: Record<string, string> = {
  trial: "Trial",
  active: "Active",
  expired: "Expired",
  inactive: "Pending",
};

/** Effective subscription status pill (trial / active / expired / pending). */
export function StatusBadge({ row }: { row: SubscriptionLike }) {
  const { status, isTrial, trialDaysLeft } = resolveSubscription(row);
  const cls = STATUS_STYLES[status] ?? STATUS_STYLES.inactive;
  const label = STATUS_LABEL[status] ?? status;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
      <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
      {label}
      {isTrial && trialDaysLeft > 0 ? ` · ${trialDaysLeft}d` : ""}
    </span>
  );
}

const TIER_STYLES: Record<string, string> = {
  starter: "bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-200",
  growth: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  pro: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
};

/** Plan-tier pill (Starter / Growth / Pro), based on the gym's paid base tier. */
export function TierBadge({ tier }: { tier: string | null | undefined }) {
  const t = normalizeTier(tier);
  const label = t.charAt(0).toUpperCase() + t.slice(1);
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-bold ${TIER_STYLES[t]}`}>
      {label}
    </span>
  );
}

/** Billing-cycle text helper: monthly / yearly / —. */
export function billingLabel(cycle: string | null | undefined): string {
  const c = (cycle || "").toLowerCase();
  if (c === "yearly") return "Yearly";
  if (c === "monthly") return "Monthly";
  return "—";
}
