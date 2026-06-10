import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Flame, ShoppingBag, Tag, Loader2, PackageOpen, Coffee, Zap, Dumbbell, Smartphone, X, Megaphone, Lock } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/supabase";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StoreUpiCheckout } from "@/components/StoreUpiCheckout";
import { timeLeftLabel, isCampaignExpired } from "@/lib/campaign";

// A member's 30+ consecutive check-in days unlocks "streak" campaigns.
const STREAK_THRESHOLD = 30;

interface MemberGymStoreProps {
  memberId: string;
  /** gym_settings.id — products are stamped with this. */
  gymId?: string | null;
  /** gym_settings.gym_owner_id — campaigns are scoped to it. */
  gymOwnerId?: string | null;
}

interface StoreProduct {
  id: string;
  item_name: string;
  brand?: string | null;
  category?: string | null;
  price: number;
  stock_quantity: number;
  image_url?: string | null;
  description?: string | null;
}

interface Campaign {
  id: string;
  name: string;
  discount_percentage: number;
  target_type: "global" | "streak";
  applies_to: string;
  is_active: boolean;
  ends_at?: string | null;
}

// Gym UPI + legal details for the store checkout QR.
interface GymPayInfo {
  gym_name?: string | null;
  upi_id?: string | null;
  terms_url?: string | null;
  privacy_url?: string | null;
  refund_url?: string | null;
}

// A pending store purchase awaiting UPI payment (server-priced).
interface PendingCheckout {
  purchase_id: string;
  item_name: string;
  quantity: number;
  total_amount: number;
}

// Local-day key so consecutive-day counting is timezone-stable.
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

const categoryIcon = (category?: string | null) => {
  if (category === "Drinks") return Coffee;
  if (category === "Gear") return Dumbbell;
  return Zap; // Supplements / default
};

export function MemberGymStore({ memberId, gymId, gymOwnerId }: MemberGymStoreProps) {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [streak, setStreak] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [buyingId, setBuyingId] = useState<string | null>(null);
  const [gymPay, setGymPay] = useState<GymPayInfo | null>(null);
  const [pendingCheckout, setPendingCheckout] = useState<PendingCheckout | null>(null);
  const [pendingPurchases, setPendingPurchases] = useState<PendingCheckout[]>([]);
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  // Ticks every 30s so the "ends in…" countdowns stay live.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  // ── Fetch the visible, in-stock products for this gym ────────────────────────
  const fetchProducts = useCallback(async () => {
    if (!gymId) return;
    const { data, error } = await supabase
      .from("inventory")
      .select("id, item_name, brand, category, price, stock_quantity, image_url, description")
      .eq("gym_id", gymId)
      .eq("show_in_app", true)
      .gt("stock_quantity", 0)
      .order("created_at", { ascending: false });
    if (!error) setProducts((data as StoreProduct[]) || []);
  }, [gymId]);

  // ── Fetch active campaigns for this gym's owner ──────────────────────────────
  const fetchCampaigns = useCallback(async () => {
    if (!gymOwnerId) return;
    const { data, error } = await supabase
      .from("campaigns")
      .select("id, name, discount_percentage, target_type, applies_to, is_active, ends_at")
      .eq("gym_owner_id", gymOwnerId)
      .eq("is_active", true);
    if (!error) setCampaigns((data as Campaign[]) || []);
  }, [gymOwnerId]);

  // ── Gym UPI + legal details for the checkout QR ──────────────────────────────
  const fetchGymPay = useCallback(async () => {
    if (!gymId) return;
    const { data } = await supabase
      .from("gym_settings")
      .select("gym_name, upi_id, terms_url, privacy_url, refund_url")
      .eq("id", gymId)
      .maybeSingle();
    if (data) setGymPay(data as GymPayInfo);
  }, [gymId]);

  // ── The member's own pending (unpaid/unverified) store purchases ─────────────
  const fetchPendingPurchases = useCallback(async () => {
    const { data, error } = await supabase
      .from("purchases")
      .select("id, item_name, quantity, total_amount")
      .eq("member_id", memberId)
      .eq("status", "pending_verification")
      .order("created_at", { ascending: false });
    if (!error) {
      setPendingPurchases(
        (data || []).map((r: any) => ({
          purchase_id: r.id,
          item_name: r.item_name || "item",
          quantity: r.quantity ?? 1,
          total_amount: Number(r.total_amount) || 0,
        }))
      );
    }
  }, [memberId]);

  // ── Compute the member's current consecutive-day check-in streak ─────────────
  const fetchStreak = useCallback(async () => {
    // Pull the last ~120 days of check-ins; plenty for a 30-day streak.
    const since = new Date();
    since.setDate(since.getDate() - 120);
    const { data, error } = await supabase
      .from("check_ins")
      .select("check_in_time")
      .eq("member_id", memberId)
      .gte("check_in_time", since.toISOString());
    if (error || !data) {
      setStreak(0);
      return;
    }

    const days = new Set(data.map((c: { check_in_time: string }) => dayKey(c.check_in_time)));
    let count = 0;
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // Grace: if there's no check-in today yet, start counting from yesterday so
    // an active streak isn't broken just because they haven't been in today.
    if (!days.has(dayKey(cursor.toISOString()))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (days.has(dayKey(cursor.toISOString()))) {
      count += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    setStreak(count);
  }, [memberId]);

  useEffect(() => {
    let active = true;
    (async () => {
      setIsLoading(true);
      // Sweep stale holds (>30 min) first so stock + the pending list reflect
      // post-expiry state. Best-effort — the call resolves with {error} (never
      // throws) so a missing migration is harmless.
      await supabase.rpc("expire_stale_store_purchases", { p_minutes: 30 });
      await Promise.all([
        fetchProducts(),
        fetchCampaigns(),
        fetchStreak(),
        fetchGymPay(),
        fetchPendingPurchases(),
      ]);
      if (active) setIsLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [fetchProducts, fetchCampaigns, fetchStreak, fetchGymPay, fetchPendingPurchases]);

  // ── Realtime: store + campaigns + own purchases stay live for the member ─────
  useEffect(() => {
    const channel = supabase.channel(`member_store_${memberId}`);
    if (gymId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "inventory", filter: `gym_id=eq.${gymId}` },
        () => fetchProducts()
      );
    }
    if (gymOwnerId) {
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table: "campaigns", filter: `gym_owner_id=eq.${gymOwnerId}` },
        () => fetchCampaigns()
      );
    }
    // Own purchases: refresh the pending list (and stock) when the owner
    // approves/rejects or status otherwise changes.
    channel.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "purchases", filter: `member_id=eq.${memberId}` },
      () => {
        fetchPendingPurchases();
        fetchProducts();
      }
    );
    channel.subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [memberId, gymId, gymOwnerId, fetchProducts, fetchCampaigns, fetchPendingPurchases]);

  // Buy → the secure RPC reserves stock and creates a pending, server-priced
  // purchase (campaign + streak discount re-derived server-side). We then show
  // the gym's UPI QR for the returned total; the owner approves it afterwards.
  const handleBuy = useCallback(
    async (productId: string) => {
      setBuyingId(productId);
      try {
        const { data, error } = await supabase.rpc("initiate_store_purchase", {
          p_product_id: productId,
          p_quantity: 1,
        });
        if (error) throw error;
        const result = (data ?? {}) as {
          success: boolean;
          error?: string;
          purchase_id?: string;
          item_name?: string;
          quantity?: number;
          total_amount?: number;
        };
        if (!result.success) {
          toast.error(result.error || "Could not start the purchase.");
          return;
        }
        // Open the UPI checkout for the server-computed total.
        setPendingCheckout({
          purchase_id: result.purchase_id!,
          item_name: result.item_name ?? "item",
          quantity: result.quantity ?? 1,
          total_amount: Number(result.total_amount ?? 0),
        });
        fetchProducts(); // reflect the reserved stock (realtime also covers this)
        fetchPendingPurchases(); // surface it in the pending banner
      } catch (err: any) {
        const m = (err?.message || "").toLowerCase();
        const msg =
          m.includes("does not exist") || m.includes("function")
            ? "Purchases aren't enabled yet — run the store UPI migration."
            : err?.message || "Purchase failed.";
        toast.error(msg);
      } finally {
        setBuyingId(null);
      }
    },
    [fetchProducts, fetchPendingPurchases]
  );

  // Cancel a pending purchase → server restores the reserved stock.
  const handleCancel = useCallback(
    async (purchaseId: string) => {
      setCancelingId(purchaseId);
      try {
        const { data, error } = await supabase.rpc("cancel_store_purchase", {
          p_purchase_id: purchaseId,
        });
        if (error) throw error;
        const result = (data ?? {}) as { success: boolean; error?: string };
        if (!result.success) {
          toast.error(result.error || "Could not cancel the purchase.");
          return;
        }
        toast.success("Purchase cancelled — the item is back in stock.");
        if (pendingCheckout?.purchase_id === purchaseId) setPendingCheckout(null);
        fetchPendingPurchases();
        fetchProducts();
      } catch (err: any) {
        toast.error(err?.message || "Could not cancel the purchase.");
      } finally {
        setCancelingId(null);
      }
    },
    [pendingCheckout, fetchPendingPurchases, fetchProducts]
  );

  const streakUnlocked = streak >= STREAK_THRESHOLD;
  const hasStreakCampaign = useMemo(() => campaigns.some((c) => c.target_type === "streak"), [campaigns]);

  // ── Live campaigns to surface as "Special Offers" banners ────────────────────
  // Active, not auto-expired; biggest discount first. `nowMs` is a dep so an
  // expiring campaign drops off the banner live without a refetch.
  const liveCampaigns = useMemo(
    () =>
      campaigns
        .filter((c) => c.is_active && !isCampaignExpired(c.ends_at))
        .sort((a, b) => Number(b.discount_percentage) - Number(a.discount_percentage)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [campaigns, nowMs]
  );

  // ── Pick the best applicable campaign per product ────────────────────────────
  const pricedProducts = useMemo(() => {
    return products.map((product) => {
      const applicable = campaigns.filter((c) => {
        if (!c.is_active) return false;
        if (isCampaignExpired(c.ends_at)) return false; // auto-expired
        const categoryOk = c.applies_to === "All" || c.applies_to === product.category;
        if (!categoryOk) return false;
        if (c.target_type === "streak") return streakUnlocked;
        return true; // global applies to everyone
      });

      const best = applicable.reduce<Campaign | null>(
        (acc, c) => (!acc || c.discount_percentage > acc.discount_percentage ? c : acc),
        null
      );

      const discountPct = best ? Number(best.discount_percentage) : 0;
      const finalPrice = best ? Math.round(product.price * (1 - discountPct / 100)) : product.price;

      return { product, best, discountPct, finalPrice };
    });
    // nowMs is included so an expiring campaign drops off live without a refetch.
  }, [products, campaigns, streakUnlocked, nowMs]);

  if (isLoading) {
    return (
      <div className="flex min-h-[18rem] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-violet-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-100 text-violet-600">
          <ShoppingBag className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-slate-900">Gym Store</h2>
          <p className="text-sm text-slate-500">Supplements, drinks & gear from your gym.</p>
        </div>
      </div>

      {/* Pending purchases — reserved stock awaiting payment/owner approval.
          Lets the member re-open the UPI QR or cancel (which restores stock). */}
      {pendingPurchases.length > 0 && (
        <div className="space-y-2 rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
          <p className="flex items-center gap-2 text-sm font-bold text-amber-800">
            <Smartphone className="h-4 w-4" />
            Awaiting payment ({pendingPurchases.length})
          </p>
          {pendingPurchases.map((p) => {
            const busy = cancelingId === p.purchase_id;
            return (
              <div
                key={p.purchase_id}
                className="flex items-center justify-between gap-3 rounded-xl border border-amber-100 bg-white p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">
                    {p.quantity}× {p.item_name}
                  </p>
                  <p className="text-xs text-slate-500">
                    ₹{p.total_amount.toLocaleString("en-IN")} · stock held until paid
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => setPendingCheckout(p)}
                    disabled={busy}
                    className="h-9 gap-1 rounded-lg bg-violet-600 font-bold text-white hover:bg-violet-700"
                  >
                    <Smartphone className="h-4 w-4" />
                    Show QR
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCancel(p.purchase_id)}
                    disabled={busy}
                    className="h-9 gap-1 rounded-lg border-slate-200 font-bold text-slate-500 hover:bg-red-50 hover:text-red-600"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
                    Cancel
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Streak status — only when a streak campaign is live */}
      {hasStreakCampaign && (
        <div
          className={`flex items-center gap-3 rounded-2xl border p-4 ${
            streakUnlocked
              ? "border-orange-200 bg-gradient-to-r from-orange-50 to-amber-50"
              : "border-slate-200 bg-slate-50"
          }`}
        >
          <Flame className={`h-6 w-6 shrink-0 ${streakUnlocked ? "text-orange-500" : "text-slate-400"}`} />
          <p className="text-sm font-medium text-slate-700">
            {streakUnlocked ? (
              <>
                You're on a <span className="font-bold text-orange-600">{streak}-day streak</span> — streak deals
                unlocked! 🔥
              </>
            ) : (
              <>
                You're on a <span className="font-bold text-slate-900">{streak}-day streak</span>. Check in{" "}
                <span className="font-bold text-orange-600">{STREAK_THRESHOLD - streak} more day{STREAK_THRESHOLD - streak === 1 ? "" : "s"}</span>{" "}
                to unlock exclusive discounts.
              </>
            )}
          </p>
        </div>
      )}

      {/* Special Offers — the gym's live campaigns, with their conditions */}
      {liveCampaigns.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Megaphone className="h-4 w-4 text-violet-600" />
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-700">
              Special Offers ({liveCampaigns.length})
            </h3>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {liveCampaigns.map((c) => {
              const isStreak = c.target_type === "streak";
              const scope = c.applies_to === "All" ? "Entire store" : c.applies_to;
              const countdown = c.ends_at ? timeLeftLabel(c.ends_at, nowMs) : null;
              const locked = isStreak && !streakUnlocked;
              const daysToGo = Math.max(STREAK_THRESHOLD - streak, 0);
              return (
                <motion.div
                  key={c.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`relative overflow-hidden rounded-2xl border p-4 ${
                    isStreak
                      ? "border-orange-200 bg-gradient-to-br from-orange-50 to-amber-50"
                      : "border-violet-200 bg-gradient-to-br from-violet-50 to-fuchsia-50"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white ${
                        isStreak ? "bg-gradient-to-br from-orange-500 to-amber-500" : "bg-violet-600"
                      }`}
                    >
                      {isStreak ? <Flame className="h-5 w-5" /> : <Tag className="h-5 w-5" />}
                    </div>
                    <div className="min-w-0">
                      <span className={`text-lg font-black ${isStreak ? "text-orange-600" : "text-violet-600"}`}>
                        {Number(c.discount_percentage)}% OFF
                      </span>
                      <p className="truncate text-sm font-bold text-slate-900">{c.name}</p>
                    </div>
                  </div>

                  {/* Conditions: scope · audience · timing */}
                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {scope}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                        isStreak ? "bg-orange-100 text-orange-700" : "bg-white/70 text-slate-600"
                      }`}
                    >
                      {isStreak ? `${STREAK_THRESHOLD}+ day streak` : "Everyone"}
                    </span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                      {countdown && countdown !== "Ended" ? `⏳ ${countdown}` : "No end date"}
                    </span>
                  </div>

                  {/* Streak gate hint */}
                  {locked && (
                    <p className="mt-2 flex items-center gap-1 text-[11px] font-medium text-orange-700">
                      <Lock className="h-3 w-3" />
                      Check in {daysToGo} more day{daysToGo === 1 ? "" : "s"} to unlock this offer.
                    </p>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {pricedProducts.length === 0 ? (
        <div className="flex min-h-[16rem] flex-col items-center justify-center gap-3 rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-center">
          <PackageOpen className="h-10 w-10 text-slate-300" />
          <p className="text-sm font-medium text-slate-500">The store is empty right now.</p>
          <p className="text-xs text-slate-400">Check back soon — your gym hasn't listed any products yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {pricedProducts.map(({ product, best, discountPct, finalPrice }) => {
            const Icon = categoryIcon(product.category);
            const isStreakDeal = best?.target_type === "streak";
            const countdown = best?.ends_at ? timeLeftLabel(best.ends_at, nowMs) : null;
            return (
              <motion.div
                key={product.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="group relative overflow-hidden rounded-3xl border border-slate-100 bg-white shadow-sm transition-all hover:shadow-lg"
              >
                {/* Discount badge */}
                {best && (
                  <div className="absolute left-4 top-4 z-10">
                    {isStreakDeal ? (
                      <Badge className="gap-1 border-none bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-[0_0_18px_rgba(249,115,22,0.6)]">
                        <Flame className="h-3 w-3" />
                        Streak Unlocked! {discountPct}% Off
                      </Badge>
                    ) : (
                      <Badge className="gap-1 border-none bg-violet-600 text-white shadow-md">
                        <Tag className="h-3 w-3" />
                        {discountPct}% Off
                      </Badge>
                    )}
                  </div>
                )}

                {/* Image */}
                <div className="aspect-square w-full overflow-hidden bg-slate-50">
                  {product.image_url ? (
                    <img
                      src={product.image_url}
                      alt={product.item_name}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center text-slate-300">
                      <Icon className="h-16 w-16 opacity-30" />
                    </div>
                  )}
                </div>

                {/* Body */}
                <div className="space-y-2 p-5">
                  {product.brand && (
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{product.brand}</p>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-bold text-slate-900">{product.item_name}</h3>
                    {product.category && (
                      <span className="shrink-0 rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-500">
                        {product.category}
                      </span>
                    )}
                  </div>

                  <div className="flex items-baseline gap-2 pt-1">
                    {best ? (
                      <>
                        <span
                          className={`text-2xl font-black ${isStreakDeal ? "text-orange-600" : "text-violet-600"}`}
                        >
                          ₹{finalPrice.toLocaleString()}
                        </span>
                        <span className="text-sm font-medium text-slate-400 line-through">
                          ₹{product.price.toLocaleString()}
                        </span>
                      </>
                    ) : (
                      <span className="text-2xl font-black text-slate-900">₹{product.price.toLocaleString()}</span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-xs text-slate-400">{product.stock_quantity} in stock</p>
                    {countdown && countdown !== "Ended" && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                          isStreakDeal ? "bg-orange-100 text-orange-700" : "bg-violet-100 text-violet-700"
                        }`}
                      >
                        ⏳ {countdown}
                      </span>
                    )}
                  </div>

                  <Button
                    onClick={() => handleBuy(product.id)}
                    disabled={buyingId === product.id || product.stock_quantity < 1}
                    className={`mt-3 h-11 w-full rounded-xl font-bold text-white transition-all ${
                      isStreakDeal
                        ? "bg-gradient-to-r from-orange-500 to-amber-500 hover:from-orange-600 hover:to-amber-600"
                        : "bg-violet-600 hover:bg-violet-700"
                    } disabled:opacity-60`}
                  >
                    {buyingId === product.id ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Buying…
                      </>
                    ) : (
                      <>
                        <ShoppingBag className="mr-2 h-4 w-4" />
                        Buy · ₹{finalPrice.toLocaleString()}
                      </>
                    )}
                  </Button>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* UPI checkout for the reserved/pending purchase. */}
      <StoreUpiCheckout
        open={!!pendingCheckout}
        onClose={() => setPendingCheckout(null)}
        upiId={gymPay?.upi_id}
        gymName={gymPay?.gym_name || "your gym"}
        amount={pendingCheckout?.total_amount ?? 0}
        itemName={pendingCheckout?.item_name ?? "item"}
        quantity={pendingCheckout?.quantity ?? 1}
        termsUrl={gymPay?.terms_url}
        privacyUrl={gymPay?.privacy_url}
        refundUrl={gymPay?.refund_url}
        onPaid={() => {
          toast.success("Payment submitted! The gym will confirm it shortly.");
          setPendingCheckout(null);
        }}
      />
    </div>
  );
}

export default MemberGymStore;
