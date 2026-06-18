import { useEffect, useState } from "react";
import { Loader2, CheckCircle2, Clock, XCircle } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { fetchMySubscriptionPayments, type SubscriptionPayment } from "@/lib/platform-billing";
import { formatINR } from "@/lib/plans";

const STATUS_META = {
  approved: { label: "Approved", icon: CheckCircle2, cls: "text-emerald-600 bg-emerald-50" },
  pending_verification: { label: "Pending verification", icon: Clock, cls: "text-amber-600 bg-amber-50" },
  rejected: { label: "Rejected", icon: XCircle, cls: "text-red-600 bg-red-50" },
} as const;

// Owner-facing history of their subscription payment requests + statuses.
export function SubscriptionHistory() {
  const { user } = useAuth();
  const [rows, setRows] = useState<SubscriptionPayment[] | null>(null);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    fetchMySubscriptionPayments(user.id)
      .then((r) => { if (!cancelled) setRows(r); })
      .catch(() => { if (!cancelled) setRows([]); });
    return () => { cancelled = true; };
  }, [user?.id]);

  if (rows === null) {
    return (
      <div className="flex justify-center py-6">
        <Loader2 className="h-5 w-5 animate-spin text-violet-500" />
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No subscription payments yet.</p>;
  }

  return (
    <div className="space-y-2">
      {rows.map((r) => {
        const meta = STATUS_META[r.status as keyof typeof STATUS_META] ?? STATUS_META.pending_verification;
        const Icon = meta.icon;
        return (
          <div
            key={r.id}
            className="flex flex-col gap-2 rounded-xl border border-slate-100 bg-white p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="min-w-0">
              <p className="text-sm font-bold capitalize text-slate-900">
                {r.tier} · {r.billing_cycle}
              </p>
              <p className="text-xs text-muted-foreground">
                {new Date(r.created_at).toLocaleDateString()} · {formatINR(Number(r.amount))}
                {r.utr ? ` · UTR ${r.utr}` : ""}
              </p>
              {r.notes && <p className="text-xs italic text-muted-foreground">“{r.notes}”</p>}
              {r.status === "rejected" && r.reject_reason && (
                <p className="text-xs text-red-500">Reason: {r.reject_reason}</p>
              )}
            </div>
            <span
              className={`inline-flex w-fit shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${meta.cls}`}
            >
              <Icon className="h-3.5 w-3.5" /> {meta.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default SubscriptionHistory;
