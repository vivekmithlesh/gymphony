import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Clock, Check, X, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PendingPayment {
  id: string;
  member_id: string;
  amount: number;
  plan_name?: string | null;
  payment_method?: string | null;
  payment_date?: string | null;
  created_at?: string | null;
  utr?: string | null;
  evidence_url?: string | null;
  member_name?: string;
}

interface OwnerPendingPaymentsProps {
  ownerId: string | null | undefined;
  /**
   * Controls only the *alert* (toast on a newly-arrived pending payment) — NOT
   * the approval UI, which is always available so the owner can never be locked
   * out of approving. Maps to gym_settings.notify_pending_payment.
   */
  alertsEnabled?: boolean;
}

// Owner-side approval for manual UPI payments members submit as
// 'pending_verification'. Approve activates the member's plan; reject dismisses.
// Self-hides when there's nothing pending, so it only appears when action's due.
export function OwnerPendingPayments({ ownerId, alertsEnabled = true }: OwnerPendingPaymentsProps) {
  const [payments, setPayments] = useState<PendingPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  // Read the latest alert preference inside the realtime callback without
  // re-subscribing whenever it flips.
  const alertsRef = useRef(alertsEnabled);
  useEffect(() => { alertsRef.current = alertsEnabled; }, [alertsEnabled]);

  const fetchPending = useCallback(async () => {
    if (!ownerId) return;
    try {
      const { data, error } = await supabase
        .from("payments")
        .select("id, member_id, amount, plan_name, payment_method, payment_date, created_at, utr, evidence_url")
        .eq("gym_owner_id", ownerId)
        .eq("status", "pending_verification")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("Pending payments fetch error:", error.message);
        return;
      }

      const rows = (data as PendingPayment[]) || [];
      // Resolve member names from members (fallback profiles) in one shot.
      const ids = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)));
      const nameById = new Map<string, string>();
      if (ids.length) {
        const { data: members } = await supabase.from("members").select("id, full_name").in("id", ids);
        members?.forEach((m: any) => m.full_name && nameById.set(m.id, m.full_name));
        const missing = ids.filter((id) => !nameById.has(id));
        if (missing.length) {
          const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", missing);
          profs?.forEach((p: any) => p.full_name && nameById.set(p.id, p.full_name));
        }
      }
      setPayments(rows.map((r) => ({ ...r, member_name: nameById.get(r.member_id) || "Member" })));
    } finally {
      setIsLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    fetchPending();
    if (!ownerId) return;
    const channel = supabase
      .channel(`owner_pending_payments_${ownerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payments", filter: `gym_owner_id=eq.${ownerId}` },
        (payload: any) => {
          // The alert (toast) only fires for a newly-arrived pending payment and
          // only when the owner has the preference enabled. The list itself
          // always refreshes regardless, so the approval UI stays current.
          if (
            alertsRef.current &&
            payload?.eventType === "INSERT" &&
            payload?.new?.status === "pending_verification"
          ) {
            toast.info("New UPI payment awaiting your approval.");
          }
          fetchPending();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId, fetchPending]);

  const act = async (id: string, kind: "approve" | "reject") => {
    setActingId(id);
    try {
      const { data, error } = await supabase.rpc(
        kind === "approve" ? "approve_payment" : "reject_payment",
        { p_payment_id: id }
      );
      if (error) throw error;
      const result = (data ?? {}) as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || "Could not update the payment.");
        return;
      }
      setPayments((prev) => prev.filter((p) => p.id !== id)); // optimistic; realtime confirms
      toast.success(kind === "approve" ? "Payment approved — member activated." : "Payment rejected.");
    } catch (err: any) {
      // PGRST202 = PostgREST genuinely can't find the RPC (migration not applied
      // or schema cache stale). Only THEN show the migration hint. Every other
      // failure is a real runtime error — surface its actual message (+ details)
      // so it isn't masked behind the canned hint.
      if (err?.code === "PGRST202") {
        toast.error("Approval isn't enabled yet — run the payment verification migration.");
      } else {
        const detail = [err?.message, err?.details, err?.hint].filter(Boolean).join(" — ");
        console.error(`${kind}_payment failed:`, err);
        toast.error(detail || "Action failed.");
      }
    } finally {
      setActingId(null);
    }
  };

  // Self-hide when idle.
  if (isLoading || payments.length === 0) return null;

  return (
    <Card className="border-amber-200 bg-amber-50/40 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
          <Clock className="h-5 w-5 text-amber-500" />
          Pending Payments ({payments.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 max-h-64 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
        <AnimatePresence initial={false}>
          {payments.map((p) => {
            const busy = actingId === p.id;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="flex items-center justify-between gap-3 rounded-2xl border border-amber-100 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900">{p.member_name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Smartphone className="h-3 w-3" />
                    {p.payment_method || "UPI"} · {p.plan_name || "Membership"} ·{" "}
                    <span className="font-bold text-slate-700">₹{Number(p.amount).toLocaleString("en-IN")}</span>
                  </p>
                  {(p.utr || p.evidence_url) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
                      {p.utr && <span>UTR: <span className="font-mono font-semibold text-slate-700">{p.utr}</span></span>}
                      {p.evidence_url && (
                        <a
                          href={p.evidence_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-semibold text-violet-600 hover:text-violet-700"
                        >
                          View proof
                        </a>
                      )}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => act(p.id, "approve")}
                    disabled={busy}
                    className="h-9 gap-1 rounded-lg bg-emerald-600 font-bold text-white hover:bg-emerald-700"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => act(p.id, "reject")}
                    disabled={busy}
                    className="h-9 gap-1 rounded-lg border-slate-200 font-bold text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    <X className="h-4 w-4" />
                    Reject
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default OwnerPendingPayments;
