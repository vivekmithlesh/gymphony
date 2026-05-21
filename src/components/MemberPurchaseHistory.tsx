import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
      }));

      // Try to fetch from inventory_sales (if exists) or just use payments for now
      // Since I didn't find inventory_sales, I'll stick to payments but add a placeholder for future
      
      setPurchases(formattedPayments);
      
      if (formattedPayments.length > 0) {
        const total = formattedPayments.reduce((sum, p) => sum + (Number(p.price) || 0), 0);
        setTotalSpent(total);
      }
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
          <div className="space-y-3">
            {purchases.map((purchase) => (
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
                  <div className="flex items-center gap-2 mt-1">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${getCategoryColor(purchase.category)}`}>
                      {purchase.category || "Item"}
                    </span>
                    <span className="text-xs text-slate-500">Qty: {purchase.quantity}</span>
                  </div>
                </div>

                {/* Price & Date */}
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold text-slate-900">₹{(purchase.price * purchase.quantity).toLocaleString("en-IN")}</p>
                  <p className="text-xs text-slate-500 mt-1">{formatDate(purchase.purchase_date)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
