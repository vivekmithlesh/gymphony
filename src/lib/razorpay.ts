import { supabase } from "@/supabase";
import { toast } from "sonner";
import { PLANS, type PlanTier, type BillingCycle } from "@/lib/plans";

/**
 * Razorpay SaaS-subscription checkout (gym owner → platform).
 *
 * Security: this client NEVER writes the plan. It asks the `razorpay-create-order`
 * edge function for an order (amount computed server-side), opens Razorpay
 * Checkout, and then polls gym_settings until the `razorpay-webhook` (the only
 * authorized writer, verified by HMAC signature) grants the plan. So a tampered
 * client cannot self-upgrade — the worst it can do is open a checkout.
 */

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open: () => void };
  }
}

const SCRIPT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = SCRIPT_SRC;
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

/** Poll gym_settings until the webhook flips this owner onto the paid tier. */
async function waitForActivation(ownerId: string, tier: PlanTier, attempts = 15): Promise<boolean> {
  for (let i = 0; i < attempts; i++) {
    const { data } = await supabase
      .from("gym_settings")
      .select("plan_tier, plan_status")
      .eq("gym_owner_id", ownerId)
      .single();
    if (data?.plan_status === "active" && data?.plan_tier === tier) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

interface CheckoutArgs {
  tier: PlanTier;
  cycle: BillingCycle;
  ownerId: string;
  ownerEmail?: string | null;
  ownerName?: string | null;
  setProcessing: (b: boolean) => void;
  onActivated?: () => void;
}

export async function startSubscriptionCheckout({
  tier,
  cycle,
  ownerId,
  ownerEmail,
  ownerName,
  setProcessing,
  onActivated,
}: CheckoutArgs): Promise<void> {
  setProcessing(true);
  try {
    // 1. Ask the edge function for an order (it validates tier + computes amount).
    const { data, error } = await supabase.functions.invoke("razorpay-create-order", {
      body: { tier, cycle },
    });

    if (error || !data?.orderId) {
      const code = (data as any)?.error || (error as any)?.message || "";
      if (String(code).includes("razorpay_not_configured")) {
        toast.error("Payments aren't configured yet. Please contact support to upgrade.");
      } else {
        toast.error("Could not start checkout. Please try again.");
      }
      setProcessing(false);
      return;
    }

    // 2. Load Razorpay Checkout.
    const loaded = await loadRazorpayScript();
    if (!loaded || !window.Razorpay) {
      toast.error("Could not load the payment gateway. Check your connection.");
      setProcessing(false);
      return;
    }

    const plan = PLANS[tier];
    const rzp = new window.Razorpay({
      key: data.keyId,
      order_id: data.orderId,
      amount: data.amount,
      currency: data.currency || "INR",
      name: "Gymphony",
      description: `${plan.name} plan (${cycle})`,
      prefill: { email: ownerEmail || undefined, name: ownerName || undefined },
      theme: { color: "#7B2CFF" },
      handler: async () => {
        // Payment captured client-side; the webhook is what actually grants the
        // plan. Wait for it, then refresh.
        toast.info("Payment received — activating your plan…");
        const activated = await waitForActivation(ownerId, tier);
        setProcessing(false);
        if (activated) {
          toast.success(`Welcome to ${plan.name}! Your plan is active.`);
          onActivated?.();
        } else {
          toast.message("Payment received. Your plan will activate shortly — refresh in a moment.");
        }
      },
      modal: {
        ondismiss: () => setProcessing(false),
      },
    });
    rzp.open();
  } catch (e) {
    console.error("Razorpay checkout error:", e);
    toast.error("Checkout failed. Please try again.");
    setProcessing(false);
  }
}
