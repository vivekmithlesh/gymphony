// Gym detail drawer for the Platform Super Admin panel. Opens on "View Details",
// fetches the admin-gated drill-down (app_admin_gym_detail) and shows the gym's
// owner, subscription lifecycle, member count and recent owner logins.

import { useEffect, useState } from "react";
import { AlertTriangle, Building2, CalendarClock, Mail, Users } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { PremiumSyncing } from "@/components/PremiumLoader";
import {
  getGymAdminDetail,
  formatDate,
  formatDateTime,
  type AdminGymDetail,
} from "@/lib/platform-admin";
import { StatusBadge, TierBadge, billingLabel } from "./shared";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right text-sm font-semibold text-foreground">{value}</span>
    </div>
  );
}

export function GymDetailSheet({
  gymId,
  open,
  onOpenChange,
}: {
  gymId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<AdminGymDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !gymId) return;
    let active = true;
    setLoading(true);
    setError(null);
    setDetail(null);
    getGymAdminDetail(gymId)
      .then((d) => {
        if (active) setDetail(d);
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Could not load gym details.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, gymId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
      >
        <SheetHeader className="space-y-1 text-left">
          <SheetTitle className="flex items-center gap-2 text-xl">
            <Building2 className="h-5 w-5 text-violet-500" />
            {detail?.gym_name ?? "Gym details"}
          </SheetTitle>
          <SheetDescription>Platform admin view — owner & subscription.</SheetDescription>
        </SheetHeader>

        {loading && <PremiumSyncing label="Loading gym…" />}

        {!loading && error && (
          <div className="mt-6 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {!loading && !error && !detail && (
          <p className="mt-6 text-sm text-muted-foreground">Gym not found.</p>
        )}

        {!loading && !error && detail && (
          <div className="mt-6 space-y-6">
            {/* Subscription summary */}
            <div className="rounded-2xl bg-gradient-to-br from-violet-600 via-purple-600 to-fuchsia-600 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between gap-2">
                <TierBadge tier={detail.plan_tier} />
                <StatusBadge row={detail} />
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/70">Members</p>
                  <p className="mt-0.5 flex items-center gap-1 text-2xl font-bold">
                    <Users className="h-5 w-5 opacity-80" />
                    {detail.member_count}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-white/70">Billing</p>
                  <p className="mt-0.5 text-2xl font-bold">{billingLabel(detail.billing_cycle)}</p>
                </div>
              </div>
            </div>

            {/* Owner */}
            <section className="rounded-2xl border border-border bg-card p-4">
              <h3 className="mb-1 text-sm font-bold text-foreground">Owner</h3>
              <Row label="Name" value={detail.owner_name || "—"} />
              <Row
                label="Email"
                value={
                  detail.owner_email ? (
                    <a
                      href={`mailto:${detail.owner_email}`}
                      className="inline-flex items-center gap-1 break-all text-violet-600 hover:underline dark:text-violet-300"
                    >
                      <Mail className="h-3.5 w-3.5" /> {detail.owner_email}
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Row label="Last login" value={formatDateTime(detail.last_login)} />
            </section>

            {/* Lifecycle */}
            <section className="rounded-2xl border border-border bg-card p-4">
              <h3 className="mb-1 flex items-center gap-1.5 text-sm font-bold text-foreground">
                <CalendarClock className="h-4 w-4 text-violet-500" /> Subscription
              </h3>
              <Row label="Gym created" value={formatDate(detail.created_at)} />
              <Row label="Subscription start" value={formatDate(detail.subscription_start)} />
              <Row label="Trial ends" value={formatDate(detail.trial_ends_at)} />
              <Row label="Expiry date" value={formatDate(detail.expiry_date)} />
            </section>

            {/* Recent logins */}
            <section className="rounded-2xl border border-border bg-card p-4">
              <h3 className="mb-3 text-sm font-bold text-foreground">Recent logins (90d)</h3>
              {detail.recent_logins.length === 0 ? (
                <p className="text-sm text-muted-foreground">No login activity recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {detail.recent_logins.slice(0, 10).map((l, i) => (
                    <li
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2 text-xs"
                    >
                      <span className="truncate text-muted-foreground">{l.device || "Unknown device"}</span>
                      <span className="whitespace-nowrap font-semibold text-foreground">
                        {formatDateTime(l.login_at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export default GymDetailSheet;
