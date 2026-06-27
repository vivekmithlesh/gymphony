// =============================================================================
// platform-admin — client helpers for the Platform Super Admin panel
// (/platform-admin). Every read goes through an admin-gated SECURITY DEFINER RPC
// (migration 20260716): the server checks is_platform_admin() and raises
// 'not authorized' for everyone else, so a non-admin who reaches these calls
// (e.g. by guessing the URL) gets nothing back. No table is queried directly.
//
// logLoginEvent() records a successful sign-in; identity is derived server-side
// from the session, the client only sends the (non-sensitive) user agent/device.
// =============================================================================

import { supabase } from "@/supabase";

/**
 * The hardcoded platform-owner email that is ALWAYS a super admin. This mirrors
 * (for client-side UI gating only) the server-authoritative grant inside the
 * is_platform_admin() SQL function (migration 20260716). Real access is always
 * enforced server-side; this constant just decides whether to render the
 * /platform-admin nav link + route shell.
 */
export const PLATFORM_ADMIN_EMAIL = "abhishek0892008@gmail.com";

/** Case-insensitive check against the hardcoded platform-admin email. */
export function isAdminEmail(email: string | null | undefined): boolean {
  return (email || "").trim().toLowerCase() === PLATFORM_ADMIN_EMAIL;
}

export interface PlatformAdminStats {
  total_gyms: number;
  total_owners: number;
  total_members: number;
  active_subscriptions: number;
  trial_gyms: number;
  expired_subscriptions: number;
  pending_payments: number;
}

export interface AdminGymRow {
  gym_id: string;
  gym_name: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  plan_tier: string | null;
  plan_status: string | null;
  billing_cycle: string | null;
  member_count: number;
  created_at: string | null;
  trial_ends_at: string | null;
  expiry_date: string | null;
  last_login: string | null;
}

export interface AdminLoginEvent {
  id: string;
  user_id: string | null;
  email: string | null;
  role: string | null;
  gym_id: string | null;
  gym_name: string | null;
  login_at: string;
  user_agent: string | null;
  device: string | null;
  status: string | null;
}

export interface AdminGymDetail {
  gym_id: string;
  gym_name: string;
  owner_id: string | null;
  owner_name: string | null;
  owner_email: string | null;
  plan_tier: string | null;
  plan_status: string | null;
  billing_cycle: string | null;
  member_count: number;
  created_at: string | null;
  subscription_start: string | null;
  trial_ends_at: string | null;
  expiry_date: string | null;
  last_login: string | null;
  recent_logins: Array<{
    email: string | null;
    role: string | null;
    login_at: string;
    device: string | null;
    user_agent: string | null;
    status: string | null;
  }>;
}

const EMPTY_STATS: PlatformAdminStats = {
  total_gyms: 0,
  total_owners: 0,
  total_members: 0,
  active_subscriptions: 0,
  trial_gyms: 0,
  expired_subscriptions: 0,
  pending_payments: 0,
};

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Platform-wide totals for the stat cards. Throws on non-admin / network error. */
export async function getPlatformAdminStats(): Promise<PlatformAdminStats> {
  const { data, error } = await supabase.rpc("app_admin_platform_stats");
  if (error) throw error;
  if (!data) return { ...EMPTY_STATS };
  const d = data as Partial<Record<keyof PlatformAdminStats, unknown>>;
  return {
    total_gyms: toNum(d.total_gyms),
    total_owners: toNum(d.total_owners),
    total_members: toNum(d.total_members),
    active_subscriptions: toNum(d.active_subscriptions),
    trial_gyms: toNum(d.trial_gyms),
    expired_subscriptions: toNum(d.expired_subscriptions),
    pending_payments: toNum(d.pending_payments),
  };
}

/** Every gym with its owner, subscription, member count and last-login. */
export async function getAllGymsWithSubscriptionAndMemberCount(
  limit = 500,
): Promise<AdminGymRow[]> {
  const { data, error } = await supabase.rpc("app_admin_list_gyms", { p_limit: limit });
  if (error) throw error;
  return ((data ?? []) as AdminGymRow[]).map((r) => ({
    ...r,
    member_count: toNum(r.member_count),
  }));
}

/** Most recent login events across the whole platform. */
export async function getRecentLoginEvents(limit = 100): Promise<AdminLoginEvent[]> {
  const { data, error } = await supabase.rpc("app_admin_recent_logins", { p_limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminLoginEvent[];
}

/** Drill-down for a single gym (for the detail drawer). Null if not found. */
export async function getGymAdminDetail(gymId: string): Promise<AdminGymDetail | null> {
  const { data, error } = await supabase.rpc("app_admin_gym_detail", { p_gym_id: gymId });
  if (error) throw error;
  if (!data) return null;
  const d = data as AdminGymDetail;
  return { ...d, member_count: toNum(d.member_count), recent_logins: d.recent_logins ?? [] };
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** "12 Jun 2026" — short, locale-aware date. "—" for null/invalid. */
export function formatDate(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

/** "4:05 PM" — time-only, for the login activity "Login Time" column. */
export function formatTime(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
}

/** "12 Jun 2026, 4:05 PM" — date + time for login rows. "—" for null/invalid. */
export function formatDateTime(v: string | null | undefined): string {
  if (!v) return "—";
  const t = Date.parse(v);
  if (Number.isNaN(t)) return "—";
  return new Date(t).toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Login tracking
// ---------------------------------------------------------------------------

/**
 * Best-effort: turn a raw user-agent into a short "Browser on OS / FormFactor"
 * label for the admin table. Purely cosmetic; the raw UA is stored alongside.
 */
export function describeDevice(ua: string): string {
  if (!ua) return "Unknown device";
  const os =
    /windows nt/i.test(ua) ? "Windows" :
    /android/i.test(ua) ? "Android" :
    /iphone|ipad|ipod/i.test(ua) ? "iOS" :
    /mac os x/i.test(ua) ? "macOS" :
    /linux/i.test(ua) ? "Linux" : "Unknown OS";
  const browser =
    /edg\//i.test(ua) ? "Edge" :
    /opr\//i.test(ua) || /opera/i.test(ua) ? "Opera" :
    /chrome|crios/i.test(ua) ? "Chrome" :
    /firefox|fxios/i.test(ua) ? "Firefox" :
    /safari/i.test(ua) ? "Safari" : "Browser";
  const form =
    /ipad|tablet/i.test(ua) ? "Tablet" :
    /mobi|iphone|android/i.test(ua) ? "Mobile" : "Desktop";
  return `${browser} on ${os} · ${form}`;
}

/**
 * Record a successful login. The server (app_log_login_event) derives the user
 * id, email, role and gym from the session; we only pass the user agent + a
 * friendly device label. Never throws — login tracking must not break sign-in.
 */
export async function logLoginEvent(): Promise<void> {
  try {
    const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
    await supabase.rpc("app_log_login_event", {
      p_user_agent: ua || null,
      p_device: ua ? describeDevice(ua) : null,
      p_status: "success",
    });
  } catch (err) {
    // Swallow — a failed audit insert must never block the user's session.
    console.warn("[platform-admin] login event log failed:", err);
  }
}
