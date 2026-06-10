// =============================================================================
// Supabase Edge Function: whatsapp-ai
// -----------------------------------------------------------------------------
// AI WhatsApp Receptionist backend.
//
// Uses the single-row messaging schema (see 20260602_messages_conversations.sql):
//   * one row per message in `messages`, tagged sender = 'member' | 'ai' | 'owner'
//   * one thread per member in `conversations`, carrying ai_paused
//
// Flow for an inbound member message:
//   1) insert a sender:'member' row (the BEFORE-INSERT trigger attaches/creates
//      the conversation and returns conversation_id)
//   2) if that conversation has ai_paused = true -> stop (owner handles it)
//   3) otherwise generate the reply (LLM) and insert a sender:'ai' row
//   4) (optional) deliver the reply to the member via WhatsApp Cloud API
//
// Callers:
//   - Dashboard inbox / simulator via supabase.functions.invoke('whatsapp-ai', {
//       body: { message, gymId, gymOwnerId, memberName, memberPhone }
//     }) -> { reply } | { paused: true }
//   - (later) the WhatsApp Cloud API webhook for real inbound messages.
// =============================================================================

import { corsHeaders } from "../_shared/cors.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Deno global is available in the Supabase Edge runtime.
declare const Deno: { env: { get(key: string): string | undefined } };

interface InboundPayload {
  message?: string;
  gymId?: string | null;
  gymOwnerId?: string | null;
  memberName?: string | null;
  memberPhone?: string | null;
  // conversationId?: string | null; // pass when you already know the thread
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req: Request): Promise<Response> => {
  // 1. CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ---------------------------------------------------------------------------
  // 2. (OPTIONAL) WhatsApp Cloud API webhook verification (GET).
  //    Uncomment and set WHATSAPP_VERIFY_TOKEN as a function secret to enable.
  // ---------------------------------------------------------------------------
  // if (req.method === "GET") {
  //   const url = new URL(req.url);
  //   const mode = url.searchParams.get("hub.mode");
  //   const token = url.searchParams.get("hub.verify_token");
  //   const challenge = url.searchParams.get("hub.challenge");
  //   if (mode === "subscribe" && token === Deno.env.get("WHATSAPP_VERIFY_TOKEN")) {
  //     return new Response(challenge ?? "", { status: 200, headers: corsHeaders });
  //   }
  //   return new Response("Forbidden", { status: 403, headers: corsHeaders });
  // }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 3. Parse and validate the inbound payload.
  let payload: InboundPayload;
  try {
    payload = await req.json();
  } catch (_err) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const message = (payload.message ?? "").trim();
  if (!message) {
    return json({ error: "Missing 'message' in request body" }, 400);
  }
  if (!payload.gymId) {
    return json({ error: "Missing 'gymId' in request body" }, 400);
  }

  const { gymId, gymOwnerId, memberName, memberPhone } = payload;

  // 4. Service-role client (keys auto-injected in the Edge runtime) so we can
  //    write rows and read ai_paused regardless of RLS.
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 5. Insert the inbound MEMBER message. The BEFORE-INSERT trigger attaches
    //    (or creates) the conversation, so we read conversation_id back.
    const { data: memberRow, error: memberErr } = await supabase
      .from("messages")
      .insert({
        gym_id: gymId,
        gym_owner_id: gymOwnerId ?? null,
        member_name: memberName ?? "Member",
        member_phone: memberPhone ?? null,
        sender: "member",
        content: message,
      })
      .select("id, conversation_id")
      .single();

    if (memberErr) throw memberErr;
    const conversationId = memberRow?.conversation_id ?? null;

    // 6. Respect human takeover — if AI is paused for this thread, stop here.
    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("ai_paused")
        .eq("id", conversationId)
        .maybeSingle();

      if (conv?.ai_paused) {
        return json({ paused: true, conversationId });
      }
    }

    // -------------------------------------------------------------------------
    // 7. (OPTIONAL) Ground the reply in live gym data + call your LLM.
    //    Set OPENAI_API_KEY as a function secret first.
    //
    //    const { data: gym } = await supabase
    //      .from("gym_settings")
    //      .select("gym_name, opening_time, closing_time, address")
    //      .eq("id", gymId).maybeSingle();
    //    const { data: plans } = await supabase
    //      .from("membership_plans").select("name, price, duration").eq("gym_id", gymId);
    //
    //    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
    //      method: "POST",
    //      headers: {
    //        "Authorization": `Bearer ${Deno.env.get("OPENAI_API_KEY")}`,
    //        "Content-Type": "application/json",
    //      },
    //      body: JSON.stringify({
    //        model: "gpt-4o-mini",
    //        messages: [
    //          { role: "system", content: `You are the receptionist for ${gym?.gym_name}. Hours: ${gym?.opening_time}-${gym?.closing_time}. Plans: ${JSON.stringify(plans)}.` },
    //          { role: "user", content: message },
    //        ],
    //      }),
    //    });
    //    const completion = await openaiRes.json();
    //    const reply = completion.choices?.[0]?.message?.content ?? "";
    // -------------------------------------------------------------------------

    // Mock reply (replace with the LLM call above).
    const reply =
      "This is a simulated AI response based on your gym data. Connect your OpenAI/Webhook API here.";

    // 8. Insert the AI reply as its own single row.
    const { error: aiErr } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        gym_id: gymId,
        gym_owner_id: gymOwnerId ?? null,
        member_name: memberName ?? "Member",
        member_phone: memberPhone ?? null,
        sender: "ai",
        content: reply,
      });

    if (aiErr) throw aiErr;

    // -------------------------------------------------------------------------
    // 9. (OPTIONAL) Deliver the reply to the member via WhatsApp Cloud API.
    //    Only for real webhook messages (memberPhone present), not the simulator.
    //
    //    if (memberPhone) {
    //      await fetch(
    //        `https://graph.facebook.com/v21.0/${Deno.env.get("WHATSAPP_PHONE_NUMBER_ID")}/messages`,
    //        {
    //          method: "POST",
    //          headers: {
    //            "Authorization": `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`,
    //            "Content-Type": "application/json",
    //          },
    //          body: JSON.stringify({
    //            messaging_product: "whatsapp",
    //            to: memberPhone,
    //            type: "text",
    //            text: { body: reply },
    //          }),
    //        },
    //      );
    //    }
    // -------------------------------------------------------------------------

    return json({ reply, conversationId });
  } catch (err) {
    console.error("[whatsapp-ai] Unhandled error:", err);
    return json({ error: "Failed to process the message" }, 500);
  }
});
