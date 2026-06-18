import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, CheckCircle2, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { fetchAdminSubscriptions, reviewSubscriptionPayment, type SubscriptionPayment } from "@/lib/platform-billing";
import { formatINR } from "@/lib/plans";

const STATUS_BADGE: Record<string, { cls: string; label: string }> = {
  approved: { cls: "bg-emerald-50 text-emerald-600", label: "Approved" },
  rejected: { cls: "bg-red-50 text-red-600", label: "Rejected" },
  pending_verification: { cls: "bg-amber-50 text-amber-600", label: "Pending" },
};

// Admin Payment Management: verify owner subscription payments. Approve activates
// the plan immediately (server-side) and notifies the owner; reject keeps the
// current plan, stores the reason, and notifies the owner.
export function AdminSubscriptions() {
  const [rows, setRows] = useState<SubscriptionPayment[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setRows(await fetchAdminSubscriptions(200));
    } catch (e: any) {
      toast.error(e?.message || "Could not load payments.");
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (id: string, action: "approve" | "reject") => {
    const reason = action === "reject" ? (window.prompt("Reason for rejection (optional):") ?? undefined) : undefined;
    setBusyId(id);
    try {
      const res = await reviewSubscriptionPayment(id, action, reason);
      if (!res.success) {
        toast.error(res.error || "Action failed.");
      } else {
        toast.success(action === "approve" ? "Approved — plan activated." : "Payment rejected.");
        await load();
      }
    } catch (e: any) {
      toast.error(e?.message || "Action failed.");
    } finally {
      setBusyId(null);
    }
  };

  const ordered = useMemo(() => {
    if (!rows) return [];
    const rank = (s: string) => (s === "pending_verification" ? 0 : 1);
    return [...rows].sort((a, b) => rank(a.status) - rank(b.status));
  }, [rows]);

  const pendingCount = rows?.filter((r) => r.status === "pending_verification").length ?? 0;

  if (rows === null) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader>
        <CardTitle className="text-lg font-bold text-slate-900">Payment management</CardTitle>
        <CardDescription>{pendingCount} pending verification</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">No payments yet.</p>}

        {/* Desktop: table. Mobile: stacked cards (rendered below). */}
        {rows.length > 0 && (
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="py-2 pr-3">Gym</th>
                  <th className="py-2 pr-3">Owner</th>
                  <th className="py-2 pr-3">Plan</th>
                  <th className="py-2 pr-3">Amount</th>
                  <th className="py-2 pr-3">UTR</th>
                  <th className="py-2 pr-3">Submitted</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((r) => {
                  const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending_verification;
                  return (
                    <tr key={r.id} className="border-b border-slate-50 align-top">
                      <td className="py-3 pr-3 font-semibold text-slate-900">{r.gym_name || "—"}</td>
                      <td className="py-3 pr-3">
                        {r.payer_name && <p className="font-semibold text-slate-800">{r.payer_name}</p>}
                        <p className="break-all text-muted-foreground">{r.owner_email || `${r.owner_id.slice(0, 8)}…`}</p>
                      </td>
                      <td className="py-3 pr-3 capitalize text-slate-700">{r.tier} · {r.billing_cycle}</td>
                      <td className="py-3 pr-3 font-bold text-slate-900">{formatINR(Number(r.amount))}</td>
                      <td className="py-3 pr-3">
                        <span className="break-all">{r.utr ?? "—"}</span>
                        {r.evidence_url && (
                          <a href={r.evidence_url} target="_blank" rel="noreferrer" className="ml-1 text-xs font-semibold text-violet-600 hover:underline">
                            proof
                          </a>
                        )}
                        {r.notes && <p className="mt-0.5 text-xs italic text-muted-foreground">“{r.notes}”</p>}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</td>
                      <td className="py-3 pr-3">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                          {r.status === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : r.status === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                          {badge.label}
                        </span>
                        {r.status === "rejected" && r.reject_reason && (
                          <p className="mt-0.5 max-w-[14rem] text-xs text-red-500">{r.reject_reason}</p>
                        )}
                      </td>
                      <td className="py-3 pr-0 text-right">
                        {r.status === "pending_verification" ? (
                          <div className="flex justify-end gap-2">
                            <Button size="sm" disabled={busyId === r.id} onClick={() => act(r.id, "approve")} className="bg-emerald-600 text-white hover:bg-emerald-500">
                              {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Approve"}
                            </Button>
                            <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, "reject")} className="border-red-200 text-red-600 hover:bg-red-50">
                              Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        <div className="space-y-3 md:hidden">
          {ordered.map((r) => {
            const badge = STATUS_BADGE[r.status] ?? STATUS_BADGE.pending_verification;
            return (
              <div key={r.id} className="rounded-xl border border-slate-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{r.gym_name || "—"}</p>
                    {r.payer_name && <p className="text-xs font-semibold text-slate-700">Paid by {r.payer_name}</p>}
                    <p className="break-all text-xs text-muted-foreground">{r.owner_email || `${r.owner_id.slice(0, 8)}…`}</p>
                  </div>
                  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                    {r.status === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : r.status === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                    {badge.label}
                  </span>
                </div>
                <p className="mt-2 text-sm font-semibold capitalize text-slate-800">
                  {r.tier} · {r.billing_cycle} · {formatINR(Number(r.amount))}
                </p>
                <p className="break-all text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleDateString()} · UTR {r.utr ?? "—"}
                  {r.evidence_url && (
                    <a href={r.evidence_url} target="_blank" rel="noreferrer" className="ml-1 font-semibold text-violet-600 hover:underline">proof</a>
                  )}
                </p>
                {r.notes && <p className="mt-1 text-xs italic text-muted-foreground">“{r.notes}”</p>}
                {r.status === "rejected" && r.reject_reason && <p className="mt-1 text-xs text-red-500">Reason: {r.reject_reason}</p>}
                {r.status === "pending_verification" && (
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" disabled={busyId === r.id} onClick={() => act(r.id, "approve")} className="flex-1 bg-emerald-600 text-white hover:bg-emerald-500">
                      {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <><CheckCircle2 className="mr-1 h-4 w-4" />Approve</>}
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === r.id} onClick={() => act(r.id, "reject")} className="flex-1 border-red-200 text-red-600 hover:bg-red-50">
                      <XCircle className="mr-1 h-4 w-4" />Reject
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export default AdminSubscriptions;
