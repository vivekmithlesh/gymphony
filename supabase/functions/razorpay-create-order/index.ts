// =============================================================================
// Supabase Edge Function: razorpay-create-order
// -----------------------------------------------------------------------------
// Creates a Razorpay order for a gym owner's SaaS subscription upgrade.
//
// SECURITY MODEL
//   • The caller's JWT is verified (Authorization: Bearer <access_token>) so we
//     know which owner is paying — the client cannot spoof the owner id.
//   • The order amount is computed SERVER-SIDE from a price map here (mirror of
//     src/lib/plans.ts). The client never sends the price, so it can't underpay.
//   • The owner id + tier + cycle are stamped into order.notes; the webhook
//     (razorpay-webhook) reads them back and is the ONLY thing that grants the
//     plan (via app_set_owner_plan). This function never writes gym_settings.
//
// Request body:  { tier: 'starter'|'growth'|'pro', cycle: 'monthly'|'yearly' }
// Response:      { orderId, amount, currency, keyId }
//
// Secrets:  RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET
//           SUPABASE_URL, SUPABASE_ANON_KEY (provided by the platform)
// =============================================================================

import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// Server-side price map — keep in sync with src/lib/plans.ts (PLANS[*]).
// Amounts are in paise (₹ × 100), Razorpay's smallest unit.
const PRICES: Record<string, { monthly: number; yearly: number }> = {
  starter: { monthly: 999_00, yearly: 9_990_00 },
  growth: { monthly: 1_999_00, yearly: 19_990_00 },
  pro: { monthly: 3_999_00, yearly: 39_990_00 },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const keyId = Deno.env.get("RAZORPAY_KEY_ID");
  const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
  if (!keyId || !keySecret) {
    return json({ error: "razorpay_not_configured" }, 503);
  }

  // 1. Identify the owner from their JWT (do not trust a client-sent id).
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ error: "unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  let ownerId: string | null = null;
  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: anonKey ?? "" },
    });
    if (!userRes.ok) return json({ error: "unauthorized" }, 401);
    const user = await userRes.json();
    ownerId = user?.id ?? null;
  } catch {
    return json({ error: "unauthorized" }, 401);
  }
  if (!ownerId) return json({ error: "unauthorized" }, 401);

  // 2. Validate tier/cycle and resolve the amount server-side.
  let body: { tier?: string; cycle?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const tier = String(body.tier || "");
  const cycle = body.cycle === "yearly" ? "yearly" : "monthly";
  if (!PRICES[tier]) return json({ error: "invalid_tier" }, 400);
  const amount = PRICES[tier][cycle];

  // 3. Create the Razorpay order.
  const auth = btoa(`${keyId}:${keySecret}`);
  const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `sub_${ownerId.slice(0, 8)}_${Date.now()}`,
      notes: { owner_id: ownerId, tier, cycle },
    }),
  });

  if (!orderRes.ok) {
    const detail = await orderRes.text();
    console.error("Razorpay order create failed:", detail);
    return json({ error: "order_create_failed" }, 502);
  }

  const order = await orderRes.json();
  return json({ orderId: order.id, amount, currency: "INR", keyId });
});
