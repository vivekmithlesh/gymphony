// =============================================================================
// Supabase Edge Function: send-invite
// -----------------------------------------------------------------------------
// Bulk member invite delivery for the Owner Dashboard (BulkOnboard.tsx).
// Sends each invite over the WhatsApp Cloud API, falling back to Twilio SMS.
//
// Request body:
//   { invites: [{ name?, phone, message, link? }], gymName? }
// Response:
//   { sentCount, total, results: [{ phone, sent, channel }] }
//
// Secrets (set whichever provider you use):
//   WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID            (WhatsApp Cloud API)
//   WHATSAPP_TEMPLATE_NAME                              (approved template — required
//                                                        for cold/business-initiated invites)
//   WHATSAPP_TEMPLATE_LANG  (optional, default "en")    (template language code)
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER   (SMS fallback)
// If none are configured, every invite returns sent:false and the dashboard
// falls back to manual WhatsApp deep links — nothing breaks.
//
// WhatsApp policy: messages to people who have NOT messaged you in the last 24h
// MUST use a pre-approved template. Register a template in WhatsApp Manager with:
//   • BODY (1 variable):
//       "Welcome to {{1}}! 🎉 Tap the button below to activate your Gymphony
//        membership and start tracking your attendance and fees."   ({{1}} = gym name)
//   • A call-to-action URL BUTTON (type: "Visit website" → Dynamic), with:
//       button text:  "Activate Membership"
//       URL base:     https://<your-domain>/signup?{{1}}
//     The function fills the button's {{1}} with the invite's query string
//     (gym_id=…&phone=…&token=…), so each member gets their own locked link.
// Then set WHATSAPP_TEMPLATE_NAME to that template's name.
// =============================================================================

import { corsHeaders } from "../_shared/cors.ts";

declare const Deno: { env: { get(key: string): string | undefined } };

interface Invite {
  name?: string;
  phone: string; // E.164, e.g. +9198…
  message: string;
  link?: string;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// --- WhatsApp Cloud API ------------------------------------------------------
async function sendWhatsApp(invite: Invite, gymName: string): Promise<boolean> {
  const token = Deno.env.get("WHATSAPP_TOKEN");
  const phoneId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return false; // provider not configured

  const to = invite.phone.replace(/[^\d]/g, ""); // Cloud API wants digits only
  const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const templateLang = Deno.env.get("WHATSAPP_TEMPLATE_LANG") || "en";

  // Template variables can't contain newlines, tabs, or 5+ consecutive spaces.
  const clean = (s: string) => (s || "").replace(/[\n\t]+/g, " ").replace(/ {5,}/g, " ").trim();

  // URL-button dynamic value: the query-string portion of the invite link
  // (gym_id=…&phone=…&token=…). The template's button URL base
  // (https://<domain>/signup?{{1}}) is configured in WhatsApp Manager; we only
  // supply this variable suffix. A URL button param must NOT contain spaces.
  const urlSuffix = (() => {
    try {
      const u = new URL(invite.link || "");
      return (u.search ? u.search.replace(/^\?/, "") : u.pathname.replace(/^\//, "")).replace(/\s+/g, "");
    } catch {
      return ((invite.link || "").split("?")[1] || invite.link || "").replace(/\s+/g, "");
    }
  })();

  // Prefer the approved TEMPLATE (compliant for cold invites) with a premium
  // call-to-action URL button. Fall back to plain text only when no template is
  // set (valid inside the 24h window — for testing).
  const body: Record<string, unknown> = templateName
    ? {
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: templateLang },
          components: [
            {
              type: "body",
              parameters: [{ type: "text", text: clean(gymName) || "our gym" }], // body {{1}}
            },
            {
              type: "button",
              sub_type: "url",
              index: "0",
              parameters: [{ type: "text", text: urlSuffix }], // button URL {{1}}
            },
          ],
        },
      }
    : {
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: invite.message },
      };

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) console.warn("[send-invite] WhatsApp send failed:", await res.text());
    return res.ok;
  } catch (err) {
    console.warn("[send-invite] WhatsApp error:", err);
    return false;
  }
}

// --- Twilio SMS fallback -----------------------------------------------------
async function sendSms(invite: Invite): Promise<boolean> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const auth = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM_NUMBER");
  if (!sid || !auth || !from) return false; // provider not configured

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${auth}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: invite.phone, From: from, Body: invite.message }),
    });
    if (!res.ok) console.warn("[send-invite] SMS send failed:", await res.text());
    return res.ok;
  } catch (err) {
    console.warn("[send-invite] SMS error:", err);
    return false;
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let payload: { invites?: Invite[]; gymName?: string };
  try {
    payload = await req.json();
  } catch (_err) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const invites = Array.isArray(payload?.invites) ? payload.invites : [];
  if (invites.length === 0) {
    return json({ error: "No invites provided" }, 400);
  }

  try {
    const results: { phone: string; sent: boolean; channel: string }[] = [];

    for (const inv of invites) {
      if (!inv?.phone || !inv?.message) {
        results.push({ phone: inv?.phone ?? "", sent: false, channel: "none" });
        continue;
      }
      // WhatsApp first, then SMS fallback.
      let sent = await sendWhatsApp(inv, payload.gymName || "");
      let channel = "whatsapp";
      if (!sent) {
        sent = await sendSms(inv);
        channel = sent ? "sms" : "none";
      }
      results.push({ phone: inv.phone, sent, channel });
    }

    const sentCount = results.filter((r) => r.sent).length;
    return json({ sentCount, total: invites.length, results });
  } catch (err) {
    console.error("[send-invite] Unhandled error:", err);
    return json({ error: "Failed to send invites" }, 500);
  }
});
