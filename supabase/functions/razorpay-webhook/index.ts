// =============================================================================
// Supabase Edge Function: razorpay-webhook
// -----------------------------------------------------------------------------
// The ONE authoritative writer of a gym's paid subscription. Razorpay calls this
// after a payment; we verify the signature, then grant the plan server-side via
// the SECURITY DEFINER RPC app_set_owner_plan (the only path the gym_settings
// plan-column lockdown — 20260621 — permits besides the trial starter).
//
// Because the plan is written ONLY here, a tampered client / forged request
// cannot grant Pro: without a valid Razorpay HMAC signature we reject, and the
// owner/tier/cycle come from the order.notes we stamped server-side in
// razorpay-create-order.
//
// Configure in Razorpay Dashboard → Webhooks:
//   URL    : https://<project-ref>.functions.supabase.co/razorpay-webhook
//   Events : payment.captured  (and optionally order.paid)
//   Secret : the value you also set as RAZORPAY_WEBHOOK_SECRET
//
// Secrets: RAZORPAY_WEBHOOK_SECRET, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// =============================================================================

declare const Deno: { env: { get(key: string): string | undefined } };

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// Constant-time-ish hex compare.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Months → expiry for the chosen cycle.
function expiryFor(cycle: string): string {
  const d = new Date();
  if (cycle === "yearly") d.setFullYear(d.getFullYear() + 1);
  else d.setMonth(d.getMonth() + 1);
  return d.toISOString();
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return ok({ error: "method_not_allowed" }, 405);

  const webhookSecret = Deno.env.get("RAZORPAY_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !supabaseUrl || !serviceKey) {
    console.error("razorpay-webhook not configured");
    return ok({ error: "not_configured" }, 503);
  }

  // 1. Verify signature over the RAW body (must hash the exact bytes sent).
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") || "";
  const expected = await hmacSha256Hex(webhookSecret, raw);
  if (!signature || !timingSafeEqual(signature, expected)) {
    console.warn("razorpay-webhook: invalid signature");
    return ok({ error: "invalid_signature" }, 401);
  }

  // 2. Parse and act only on a captured payment.
  let event: any;
  try {
    event = JSON.parse(raw);
  } catch {
    return ok({ error: "bad_json" }, 400);
  }

  const type = event?.event;
  if (type !== "payment.captured" && type !== "order.paid") {
    return ok({ received: true, ignored: type }); // ack non-grant events
  }

  // Notes were stamped server-side by razorpay-create-order.
  const notes =
    event?.payload?.payment?.entity?.notes ||
    event?.payload?.order?.entity?.notes ||
    {};
  const ownerId = notes.owner_id;
  const tier = notes.tier;
  const cycle = notes.cycle === "yearly" ? "yearly" : "monthly";

  if (!ownerId || !["starter", "growth", "pro"].includes(tier)) {
    console.error("razorpay-webhook: missing/invalid notes", notes);
    return ok({ error: "missing_notes" }, 400);
  }

  // 3. Grant the plan via the locked-down SECURITY DEFINER RPC (service role).
  const rpcRes = await fetch(`${supabaseUrl}/rest/v1/rpc/app_set_owner_plan`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_owner: ownerId,
      p_tier: tier,
      p_status: "active",
      p_cycle: cycle,
      p_expiry: expiryFor(cycle),
    }),
  });

  if (!rpcRes.ok) {
    const detail = await rpcRes.text();
    console.error("app_set_owner_plan failed:", detail);
    return ok({ error: "grant_failed" }, 500);
  }

  return ok({ received: true, granted: { ownerId, tier, cycle } });
});
