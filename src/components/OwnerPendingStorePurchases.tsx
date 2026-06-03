import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShoppingBag, Check, X, Loader2, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface PendingPurchase {
  id: string;
  member_id: string;
  item_name?: string | null;
  quantity: number;
  total_amount: number;
  payment_method?: string | null;
  created_at?: string | null;
  member_name?: string;
}

interface OwnerPendingStorePurchasesProps {
  ownerId: string | null | undefined;
  /** Toast on a newly-arrived pending purchase. Approval UI is always available. */
  alertsEnabled?: boolean;
}

// Owner-side approval for store purchases members pay via UPI
// ('pending_verification'). Approve finalizes the sale; reject restores the
// reserved stock. Self-hides when nothing is pending. Mirrors OwnerPendingPayments.
export function OwnerPendingStorePurchases({ ownerId, alertsEnabled = true }: OwnerPendingStorePurchasesProps) {
  const [purchases, setPurchases] = useState<PendingPurchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actingId, setActingId] = useState<string | null>(null);

  const alertsRef = useRef(alertsEnabled);
  useEffect(() => { alertsRef.current = alertsEnabled; }, [alertsEnabled]);

  const fetchPending = useCallback(async () => {
    if (!ownerId) return;
    try {
      // Sweep stale holds (>30 min) so the owner never sees abandoned pendings
      // and the stock is freed even if no member has the store open. Resolves
      // with {error} (never throws), so a missing migration is harmless.
      await supabase.rpc("expire_stale_store_purchases", { p_minutes: 30 });
      const { data, error } = await supabase
        .from("purchases")
        .select("id, member_id, item_name, quantity, total_amount, payment_method, created_at")
        .eq("gym_owner_id", ownerId)
        .eq("status", "pending_verification")
        .order("created_at", { ascending: false });
      if (error) {
        console.warn("Pending purchases fetch error:", error.message);
        return;
      }

      const rows = (data as PendingPurchase[]) || [];
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
      setPurchases(rows.map((r) => ({ ...r, member_name: nameById.get(r.member_id) || "Member" })));
    } finally {
      setIsLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    fetchPending();
    if (!ownerId) return;
    const channel = supabase
      .channel(`owner_pending_purchases_${ownerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchases", filter: `gym_owner_id=eq.${ownerId}` },
        (payload: any) => {
          if (
            alertsRef.current &&
            payload?.eventType === "INSERT" &&
            payload?.new?.status === "pending_verification"
          ) {
            toast.info("New store purchase awaiting your approval.");
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
        kind === "approve" ? "approve_store_purchase" : "reject_store_purchase",
        { p_purchase_id: id }
      );
      if (error) throw error;
      const result = (data ?? {}) as { success: boolean; error?: string };
      if (!result.success) {
        toast.error(result.error || "Could not update the purchase.");
        return;
      }
      setPurchases((prev) => prev.filter((p) => p.id !== id)); // optimistic; realtime confirms
      toast.success(kind === "approve" ? "Purchase approved." : "Purchase rejected — stock restored.");
    } catch (err: any) {
      // Only a genuine missing-RPC (PGRST202) means the migration hasn't run.
      // Every other failure is a real runtime error — surface it instead of
      // masking it behind the migration hint.
      if (err?.code === "PGRST202") {
        toast.error("Approval isn't enabled yet — run the store UPI migration.");
      } else {
        const detail = [err?.message, err?.details, err?.hint].filter(Boolean).join(" — ");
        console.error(`${kind}_store_purchase failed:`, err);
        toast.error(detail || "Action failed.");
      }
    } finally {
      setActingId(null);
    }
  };

  if (isLoading || purchases.length === 0) return null;

  return (
    <Card className="border-violet-200 bg-violet-50/40 shadow-soft">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
          <ShoppingBag className="h-5 w-5 text-violet-500" />
          Pending Store Purchases ({purchases.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AnimatePresence initial={false}>
          {purchases.map((p) => {
            const busy = actingId === p.id;
            return (
              <motion.div
                key={p.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, x: -16 }}
                className="flex items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-900">{p.member_name}</p>
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Smartphone className="h-3 w-3" />
                    {p.payment_method || "UPI"} · {p.quantity}× {p.item_name || "Item"} ·{" "}
                    <span className="font-bold text-slate-700">₹{Number(p.total_amount).toLocaleString("en-IN")}</span>
                  </p>
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

export default OwnerPendingStorePurchases;
