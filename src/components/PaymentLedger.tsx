import { useCallback, useEffect, useMemo, useState } from "react";
import { Receipt, RefreshCw, Loader2, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/supabase";
import { useAuth } from "@/lib/auth-context";

interface AuditRow {
  id: string;
  payment_id: string;
  member_id: string | null;
  action: string; // submitted | approved | rejected | status_changed
  old_status: string | null;
  new_status: string | null;
  utr: string | null;
  amount: number | string | null;
  created_at: string;
}

const ACTION_STYLE: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Submitted", cls: "bg-slate-100 text-slate-600" },
  approved: { label: "Approved", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", cls: "bg-red-50 text-red-600" },
  status_changed: { label: "Updated", cls: "bg-amber-50 text-amber-700" },
};

function ts(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Payment Ledger — read-only, append-only audit trail of every payment state
 * transition (from payment_audit, Wave 3). Mounted inside RevenueView, which is
 * already gated to Growth (revenue_analytics), so no separate gate is needed.
 */
export function PaymentLedger() {
  const { user } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const fetchAudit = useCallback(async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("payment_audit")
        .select(
          "id, payment_id, member_id, action, old_status, new_status, utr, amount, created_at",
        )
        .eq("gym_owner_id", user.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) {
        console.warn("payment_audit fetch error:", error.message);
        return;
      }
      const list = (data as AuditRow[]) || [];
      setRows(list);

      const ids = Array.from(new Set(list.map((r) => r.member_id).filter(Boolean))) as string[];
      if (ids.length) {
        const { data: members } = await supabase
          .from("members")
          .select("id, full_name")
          .in("id", ids);
        const map: Record<string, string> = {};
        members?.forEach((m: any) => m.full_name && (map[m.id] = m.full_name));
        setNames(map);
      }
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const summary = useMemo(() => {
    let approved = 0,
      rejected = 0,
      submitted = 0,
      approvedAmount = 0;
    for (const r of rows) {
      if (r.action === "approved") {
        approved++;
        approvedAmount += Number(r.amount) || 0;
      } else if (r.action === "rejected") rejected++;
      else if (r.action === "submitted") submitted++;
    }
    return { approved, rejected, submitted, approvedAmount };
  }, [rows]);

  return (
    <Card className="border-border bg-white shadow-soft">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Receipt className="h-5 w-5 text-primary" />
          Payment Ledger
        </CardTitle>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchAudit}
          disabled={loading}
          className="h-8 gap-1 rounded-lg"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <LedgerStat label="Approved" value={summary.approved} tone="text-emerald-600" />
          <LedgerStat
            label="Approved ₹"
            value={`₹${summary.approvedAmount.toLocaleString("en-IN")}`}
            tone="text-slate-900"
          />
          <LedgerStat label="Submitted" value={summary.submitted} />
          <LedgerStat label="Rejected" value={summary.rejected} tone="text-red-600" />
        </div>

        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Audit trail
          </p>
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {loading ? "Loading…" : "No payment events yet."}
            </p>
          ) : (
            <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto pr-1 custom-scrollbar">
              {rows.map((r) => {
                const style = ACTION_STYLE[r.action] ?? {
                  label: r.action,
                  cls: "bg-slate-100 text-slate-600",
                };
                return (
                  <div key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-800">
                        {r.member_id ? names[r.member_id] || "Member" : "Member"}
                        {r.amount != null && (
                          <span className="ml-2 font-bold text-slate-900">
                            ₹{Number(r.amount).toLocaleString("en-IN")}
                          </span>
                        )}
                      </p>
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        {r.old_status && (
                          <>
                            <span>{r.old_status}</span>
                            <ArrowRight className="h-3 w-3" />
                          </>
                        )}
                        <span>{r.new_status}</span>
                        {r.utr && <span className="ml-1 font-mono">· UTR {r.utr}</span>}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">{ts(r.created_at)}</span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${style.cls}`}
                      >
                        {style.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LedgerStat({
  label,
  value,
  tone = "text-slate-900",
}: {
  label: string;
  value: number | string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className={`mt-1 text-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

export default PaymentLedger;
