import { useCallback, useEffect, useState } from "react";
import { ShoppingBag, Package, Tag, TrendingUp } from "lucide-react";
import { supabase } from "@/supabase";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

interface Order {
  id: string;
  member_id: string;
  item_name?: string | null;
  quantity: number;
  total_amount: number;
  discount_percentage?: number | null;
  campaign_id?: string | null;
  created_at?: string | null;
  member_name?: string;
  campaign_name?: string;
}

interface OwnerStoreOrdersProps {
  ownerId: string | null | undefined;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Owner-facing record of who actually bought store products. Reads the
// `purchases` table (completed sales only) and resolves buyer + campaign names,
// so the owner can see their store's sales and which campaign drove each order.
export function OwnerStoreOrders({ ownerId }: OwnerStoreOrdersProps) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchOrders = useCallback(async () => {
    if (!ownerId) return;
    try {
      const { data, error } = await supabase
        .from("purchases")
        .select("id, member_id, item_name, quantity, total_amount, discount_percentage, campaign_id, created_at")
        .eq("gym_owner_id", ownerId)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        console.warn("Store orders fetch error:", error.message);
        return;
      }

      const rows = (data as Order[]) || [];

      // Resolve buyer names (members → profiles fallback) in one shot.
      const memberIds = Array.from(new Set(rows.map((r) => r.member_id).filter(Boolean)));
      const nameById = new Map<string, string>();
      if (memberIds.length) {
        const { data: members } = await supabase.from("members").select("id, full_name").in("id", memberIds);
        members?.forEach((m: any) => m.full_name && nameById.set(m.id, m.full_name));
        const missing = memberIds.filter((id) => !nameById.has(id));
        if (missing.length) {
          const { data: profs } = await supabase.from("profiles").select("id, full_name").in("id", missing);
          profs?.forEach((p: any) => p.full_name && nameById.set(p.id, p.full_name));
        }
      }

      // Resolve campaign names for orders that came through a discount.
      const campaignIds = Array.from(new Set(rows.map((r) => r.campaign_id).filter(Boolean) as string[]));
      const campaignById = new Map<string, string>();
      if (campaignIds.length) {
        const { data: camps } = await supabase.from("campaigns").select("id, name").in("id", campaignIds);
        camps?.forEach((c: any) => c.name && campaignById.set(c.id, c.name));
      }

      setOrders(
        rows.map((r) => ({
          ...r,
          member_name: nameById.get(r.member_id) || "Member",
          campaign_name: r.campaign_id ? campaignById.get(r.campaign_id) : undefined,
        }))
      );
    } finally {
      setIsLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    fetchOrders();
    if (!ownerId) return;
    const channel = supabase
      .channel(`owner_store_orders_${ownerId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchases", filter: `gym_owner_id=eq.${ownerId}` },
        () => fetchOrders()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ownerId, fetchOrders]);

  const totalRevenue = orders.reduce((sum, o) => sum + (Number(o.total_amount) || 0), 0);

  // One order row — shared between the compact card and the full-view dialog.
  const renderRow = (o: Order) => (
    <div
      key={o.id}
      className="flex items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3"
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold uppercase text-primary">
          {(o.member_name || "M").charAt(0)}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-slate-900">{o.member_name}</p>
          <p className="truncate text-xs text-slate-500">
            {o.quantity}× {o.item_name || "Item"}
          </p>
          {o.campaign_name ? (
            <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-[10px] font-bold text-purple-600">
              <Tag className="h-2.5 w-2.5" />
              {o.campaign_name} · {Number(o.discount_percentage) || 0}% off
            </span>
          ) : null}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <p className="text-sm font-bold text-slate-900">
          ₹{Number(o.total_amount).toLocaleString("en-IN")}
        </p>
        <p className="mt-0.5 text-[11px] text-slate-400">{formatDate(o.created_at)}</p>
      </div>
    </div>
  );

  return (
    <Card className="border-slate-200 bg-white shadow-soft">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
            <ShoppingBag className="h-5 w-5 text-primary" />
            Store Orders ({orders.length})
          </CardTitle>
          {orders.length > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-600">
              <TrendingUp className="h-4 w-4" />
              ₹{totalRevenue.toLocaleString("en-IN")}
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-14 rounded-2xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : orders.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <Package className="mb-2 h-10 w-10 text-slate-300" />
            <p className="text-sm font-medium text-slate-500">No orders yet</p>
            <p className="mt-1 max-w-xs text-xs text-slate-400">
              When a member buys one of your products, the order — and which campaign gave them the
              discount — shows up here.
            </p>
          </div>
        ) : (
          <>
            {/* Vertical-only scroll — capped so the card never grows the page. */}
            <div className="space-y-3 max-h-80 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {orders.map(renderRow)}
            </div>

            {/* Full view — every order in a scrollable dialog. */}
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-primary/5">
                  View all orders
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between gap-4">
                    <span>Store Orders ({orders.length})</span>
                    <span className="text-sm font-bold text-emerald-600">
                      ₹{totalRevenue.toLocaleString("en-IN")}
                    </span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
                  {orders.map(renderRow)}
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}

export default OwnerStoreOrders;
