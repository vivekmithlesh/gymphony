// =============================================================================
// platform-billing — client helpers for the manual-UPI OWNER subscription flow.
// -----------------------------------------------------------------------------
// Owner pays the platform's UPI, enters a UTR, and submits a pending request
// (app_submit_subscription_payment). A platform admin approves/rejects it
// (app_review_subscription_payment) — approval activates the plan server-side.
// All writes go through SECURITY DEFINER RPCs (migration 20260629); the client
// never writes plan/subscription rows directly.
// =============================================================================

import { supabase } from "@/supabase";
import type { PlanTier, BillingCycle } from "@/lib/plans";

export interface PlatformUpi {
  upi_id: string;
  name: string;
  note: string;
  /** Optional admin-uploaded QR image (preferred over the generated upi:// QR). */
  qr_url: string;
  support_whatsapp: string;
  support_email: string;
}

export interface SubscriptionPayment {
  id: string;
  owner_id: string;
  gym_id: string | null;
  tier: string;
  billing_cycle: string;
  amount: number;
  utr: string | null;
  evidence_url: string | null;
  notes: string | null;
  /** Name the owner entered for the UPI payment (who actually paid). */
  payer_name: string | null;
  status: "pending_verification" | "approved" | "rejected" | string;
  reject_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  /** Present only on the admin-enriched list (app_admin_list_subscriptions). */
  gym_name?: string;
  owner_email?: string;
}

export type SubmitResult =
  | { ok: true; id: string }
  | { ok: false; error: string; duplicate?: boolean; notConfigured?: boolean };

const EMPTY_UPI: PlatformUpi = {
  upi_id: "", name: "", note: "", qr_url: "", support_whatsapp: "", support_email: "",
};

/** The platform's UPI payee details (where owners send subscription payments). */
export async function getPlatformUpi(): Promise<PlatformUpi> {
  const { data, error } = await supabase.rpc("get_platform_upi");
  if (error || !data) return { ...EMPTY_UPI };
  const d = data as Partial<PlatformUpi>;
  return {
    upi_id: d.upi_id || "",
    name: d.name || "",
    note: d.note || "",
    qr_url: d.qr_url || "",
    support_whatsapp: d.support_whatsapp || "",
    support_email: d.support_email || "",
  };
}

/** Submit a pending subscription payment. Amount is computed server-side. */
export async function submitSubscriptionPayment(args: {
  tier: PlanTier;
  cycle: BillingCycle;
  utr: string;
  payerName: string;
  evidenceUrl?: string | null;
  notes?: string | null;
}): Promise<SubmitResult> {
  const { data, error } = await supabase.rpc("app_submit_subscription_payment", {
    p_tier: args.tier,
    p_cycle: args.cycle,
    p_utr: args.utr,
    p_evidence_url: args.evidenceUrl ?? null,
    p_notes: args.notes ?? null,
    p_payer_name: args.payerName,
  });
  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") return { ok: false, error: "This UTR has already been submitted.", duplicate: true };
    if (code === "PGRST202") return { ok: false, error: "Couldn't reach billing. Please try again in a moment.", notConfigured: true };
    return { ok: false, error: error.message || "Could not submit your payment." };
  }
  return { ok: true, id: data as string };
}

/** Admin: approve or reject a pending request. Approval activates the plan. */
export async function reviewSubscriptionPayment(
  id: string,
  action: "approve" | "reject",
  reason?: string,
): Promise<{ success: boolean; error?: string; status?: string }> {
  const { data, error } = await supabase.rpc("app_review_subscription_payment", {
    p_id: id,
    p_action: action,
    p_reason: reason ?? null,
  });
  if (error) throw error;
  return (data ?? { success: false }) as { success: boolean; error?: string; status?: string };
}

/** Admin: pending requests awaiting verification. */
export async function fetchPendingSubscriptions(): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("*")
    .eq("status", "pending_verification")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SubscriptionPayment[];
}

/**
 * Admin: full history enriched with Gym name + Owner email (joined server-side
 * via the admin-gated app_admin_list_subscriptions RPC — the base table's RLS
 * doesn't let an admin read other owners' gym rows directly).
 */
export async function fetchAdminSubscriptions(limit = 200): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase.rpc("app_admin_list_subscriptions", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as SubscriptionPayment[];
}

/** Owner: this owner's subscription payment history. */
export async function fetchMySubscriptionPayments(ownerId: string): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SubscriptionPayment[];
}

/** Admin: update the platform UPI payee details, QR image, and support contacts. */
export async function setPlatformUpi(args: {
  upiId: string;
  name: string;
  note?: string | null;
  qrUrl?: string | null;
  whatsapp?: string | null;
  email?: string | null;
}): Promise<void> {
  const { error } = await supabase.rpc("app_set_platform_upi", {
    p_upi_id: args.upiId,
    p_name: args.name,
    p_note: args.note ?? null,
    p_qr_url: args.qrUrl ?? null,
    p_whatsapp: args.whatsapp ?? null,
    p_email: args.email ?? null,
  });
  if (error) throw error;
}
