import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ShoppingBag, Package, Pill, Dumbbell, Shirt, WalletCards } from "lucide-react";
import { supabase } from "@/supabase";

interface MemberPurchaseHistoryProps {
  memberId: string;
}

interface Purchase {
  id: string;
  item_name: string;
  quantity: number;
  price: number;
  purchase_date: string;
  category?: string;
  image_url?: string;
  /** Raw row status: 'pending_verification' | 'rejected' | completed/Success/etc. */
  status?: string;
}

const InventoryVisual = ({ purchase }: { purchase: Purchase }) => {
  const [imageFailed, setImageFailed] = useState(false);
  const category = purchase.category?.toLowerCase() || "";

  if (purchase.image_url && !imageFailed) {
    return (
      <img
        src={purchase.image_url}
        alt={purchase.item_name}
        className="h-10 w-10 rounded-lg object-cover"
        onError={() => setImageFailed(true)}
      />
    );
  }

  if (category === "supplements") {
    return (
      <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
        <Pill className="h-5 w-5 text-blue-700" />
      </div>
    );
  }

  if (category === "accessories") {
    return (
      <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
        <WalletCards className="h-5 w-5 text-green-700" />
      </div>
    );
  }

  if (category === "apparel") {
    return (
      <div className="h-10 w-10 rounded-lg bg-orange-100 flex items-center justify-center">
        <Shirt className="h-5 w-5 text-orange-700" />
      </div>
    );
  }

  if (category === "equipment") {
    return (
      <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
        <Dumbbell className="h-5 w-5 text-purple-700" />
      </div>
    );
  }

  return (
    <div className="h-10 w-10 rounded-lg bg-purple-100 flex items-center justify-center">
      <Package className="h-5 w-5 text-purple-600" />
    </div>
  );
};

export function MemberPurchaseHistory({ memberId }: MemberPurchaseHistoryProps) {
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalSpent, setTotalSpent] = useState(0);

  useEffect(() => {
    fetchPurchaseHistory();

    // Live-update when the member buys something from the store.
    const channel = supabase
      .channel(`purchase_history_${memberId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "purchases", filter: `member_id=eq.${memberId}` },
        () => fetchPurchaseHistory()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

  const fetchPurchaseHistory = async () => {
    try {
      setIsLoading(true);

      // Fetch from payments table
      const { data: paymentsData, error: paymentsError } = await supabase
        .from("payments")
        .select("*")
        .eq("member_id", memberId)
        .order("payment_date", { ascending: false })
        .limit(10);

      if (paymentsError) {
        console.error("Error fetching payments:", paymentsError.message);
      }

      const formattedPayments: Purchase[] = (paymentsData || []).map(p => ({
        id: p.id,
        item_name: `Membership Payment`,
        quantity: 1,
        price: p.amount,
        purchase_date: p.payment_date || p.created_at,
        category: "Membership",
        status: p.status,
      }));

      // Store purchases (supplements, drinks, gear) from the gym store.
      const { data: storeData, error: storeError } = await supabase
        .from("purchases")
        .select("id, item_name, quantity, unit_price, category, image_url, created_at, status")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (storeError) {
        console.warn("Error fetching store purchases:", storeError.message);
      }

      const formattedStore: Purchase[] = (storeData || []).map((s: any) => ({
        id: s.id,
        item_name: s.item_name || "Store Item",
        quantity: s.quantity ?? 1,
        price: Number(s.unit_price) || 0,
        purchase_date: s.created_at,
        category: s.category || "Store",
        image_url: s.image_url || undefined,
        status: s.status,
      }));

      // Merge both feeds, newest first. Hide rejected/cancelled/expired entirely.
      const dropped = new Set(["rejected", "cancelled", "expired"]);
      const merged = [...formattedStore, ...formattedPayments]
        .filter((p) => !p.status || !dropped.has(p.status))
        .sort((a, b) => new Date(b.purchase_date).getTime() - new Date(a.purchase_date).getTime());

      setPurchases(merged);
      // Total = confirmed spend only; pending (awaiting gym verification) is shown
      // but not yet counted.
      setTotalSpent(
        merged
          .filter((p) => p.status !== "pending_verification")
          .reduce((sum, p) => sum + (Number(p.price) || 0) * (p.quantity || 1), 0)
      );
    } catch (error: any) {
      console.error("Error fetching purchase history:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) {
      return "N/A";
    }
    
    try {
      const date = new Date(dateString);
      
      // Check if date is valid
      if (isNaN(date.getTime())) {
        return "N/A";
      }
      
      // Safe formatting without locale options that might fail
      const day = String(date.getDate()).padStart(2, '0');
      const month = date.toLocaleString('en-US', { month: 'short' });
      
      return `${day} ${month}`;
    } catch (error) {
      console.warn("Date formatting error:", error, dateString);
      return "N/A";
    }
  };

  const getCategoryColor = (category?: string) => {
    switch (category?.toLowerCase()) {
      case "supplements":
        return "bg-blue-50 text-blue-700";
      case "accessories":
        return "bg-green-50 text-green-700";
      case "apparel":
        return "bg-orange-50 text-orange-700";
      case "equipment":
        return "bg-purple-50 text-purple-700";
      default:
        return "bg-slate-50 text-slate-700";
    }
  };

  // One purchase row — shared between the compact card and the full-view dialog.
  const renderRow = (purchase: Purchase) => (
    <div
      key={purchase.id}
      className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors"
    >
      {/* Icon */}
      <div className="shrink-0">
        <InventoryVisual purchase={purchase} />
      </div>

      {/* Item Details */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{purchase.item_name}</p>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getCategoryColor(purchase.category)}`}>
            {purchase.category || "Item"}
          </span>
          <span className="text-xs text-slate-500">Qty: {purchase.quantity}</span>
          {purchase.status === "pending_verification" && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">
              Pending
            </span>
          )}
        </div>
      </div>

      {/* Price & Date */}
      <div className="text-right shrink-0">
        <p className="text-sm font-semibold text-slate-900">₹{(purchase.price * purchase.quantity).toLocaleString("en-IN")}</p>
        <p className="text-xs text-slate-500 mt-1">{formatDate(purchase.purchase_date)}</p>
      </div>
    </div>
  );

  if (isLoading) {
    return (
      <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="text-base font-semibold text-slate-900">My Inventory</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center min-h-50">
          <div className="animate-pulse space-y-3 w-full">
            <div className="h-12 bg-slate-200 rounded-xl"></div>
            <div className="h-12 bg-slate-200 rounded-xl"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white rounded-3xl border border-slate-200 shadow-sm">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold text-slate-900">My Inventory</CardTitle>
          <div className="text-right">
            <p className="text-xs text-slate-500 font-medium">Total Spent</p>
            <p className="text-sm font-semibold text-purple-600">₹{totalSpent.toLocaleString("en-IN")}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {purchases.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <ShoppingBag className="h-10 w-10 text-slate-300 mb-2" />
            <p className="text-sm text-slate-500">No purchases yet</p>
          </div>
        ) : (
          <>
            {/* Vertical-only scroll — overflow-x-hidden stops the sideways scrollbar. */}
            <div className="space-y-3 max-h-80 overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
              {purchases.map(renderRow)}
            </div>

            {/* Full view — see every order in a scrollable dialog. */}
            <Dialog>
              <DialogTrigger asChild>
                <button className="mt-3 w-full rounded-xl border border-slate-200 py-2.5 text-sm font-semibold text-purple-600 transition-colors hover:bg-purple-50">
                  View all orders
                </button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle className="flex items-center justify-between gap-4">
                    <span>My Inventory</span>
                    <span className="text-sm font-semibold text-purple-600">
                      Total Spent ₹{totalSpent.toLocaleString("en-IN")}
                    </span>
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 max-h-[70vh] overflow-y-auto overflow-x-hidden pr-1 custom-scrollbar">
                  {purchases.map(renderRow)}
                </div>
              </DialogContent>
            </Dialog>
          </>
        )}
      </CardContent>
    </Card>
  );
}
