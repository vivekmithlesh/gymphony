// =============================================================================
// QRService — the single client entry point for everything QR.
//
// Signing and verification are deliberately NOT here: the HMAC key lives only
// in the database (app_config), so passes are MINTED by an RPC and VERIFIED by
// the kiosk_check_in RPC. This module just wraps those calls and builds the
// non-secret payloads (wall poster, join poster).
// =============================================================================
import { supabase } from "@/supabase";

export const QR_TYPES = {
  MEMBER_PASS: "member_pass",
  WALL: "wall",
  JOIN: "join",
} as const;

export interface MintedPass {
  token: string;
  expiresAt: Date;
  /** seconds until expiry, as issued */
  ttl: number;
}

export interface KioskCheckInResult {
  success: boolean;
  /** Short label for the kiosk overlay (e.g. "Wrong gym", "Expired"). */
  overlay?: string;
  error?: string;
  member_name?: string;
  status?: "granted" | "denied";
  already_checked_in?: boolean;
  message?: string;
  signed?: boolean;
}

export const QRService = {
  /**
   * Mint a short-lived, server-signed member pass for the signed-in member.
   * Returns null if the RPC is unavailable (e.g. migration not yet applied) so
   * callers can fall back to a legacy static pass.
   */
  async mintMemberPass(): Promise<MintedPass | null> {
    const { data, error } = await supabase.rpc("mint_member_pass");
    if (error || !data) return null;
    const d = data as { token: string; expires_at: string; ttl: number };
    if (!d.token) return null;
    return { token: d.token, expiresAt: new Date(d.expires_at), ttl: d.ttl };
  },

  /**
   * Server-authoritative kiosk check-in. The server verifies signature, expiry
   * and cross-gym ownership and records the attendance + audit row; the browser
   * is never trusted to decide the outcome.
   */
  async kioskCheckIn(token: string): Promise<KioskCheckInResult> {
    const { data, error } = await supabase.rpc("kiosk_check_in", { p_token: token });
    if (error) {
      return { success: false, overlay: "Error", error: error.message };
    }
    return (data ?? { success: false, error: "No response from server." }) as KioskCheckInResult;
  },

  /** Static wall-poster payload — identifies the gym for geo-fenced check-in. */
  buildWallPayload(gymId: string): string {
    return JSON.stringify({ gym_id: gymId });
  },

  /** Static join-poster payload — for a new member joining the gym. */
  buildJoinPayload(gymId: string): string {
    return JSON.stringify({ action: "join", gym_id: gymId });
  },
};
