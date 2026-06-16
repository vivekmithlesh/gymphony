// =============================================================================
// QRValidator — fast, CLIENT-SIDE, NON-AUTHORITATIVE parsing of a scanned QR.
//
// Its only jobs are (a) classify the QR so the scanner can route it, and
// (b) fail obviously-bad scans instantly for good UX. It can NOT verify a
// signature (the key is server-only) — the authoritative checks happen in the
// kiosk_check_in / process_wall_checkin RPCs. Never grant access based on this.
// =============================================================================
import { QR_TYPES } from "./QRService";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export type ParsedScan =
  | {
      type: typeof QR_TYPES.MEMBER_PASS;
      /** Raw token to hand to kiosk_check_in (signed token or legacy string). */
      token: string;
      signed: boolean;
      memberId: string | null;
      gymId: string | null;
      /** True only for signed tokens whose exp is already past (client clock). */
      expired: boolean;
    }
  | { type: typeof QR_TYPES.WALL; gymId: string }
  | { type: typeof QR_TYPES.JOIN; gymId: string }
  | { type: "unknown"; raw: string };

function decodeSignedPayload(b64: string): { mid: string | null; gid: string | null; exp: number | null } {
  try {
    const json = JSON.parse(atob(b64)) as { mid?: string; gid?: string; exp?: number };
    return { mid: json.mid ?? null, gid: json.gid ?? null, exp: typeof json.exp === "number" ? json.exp : null };
  } catch {
    return { mid: null, gid: null, exp: null };
  }
}

export const QRValidator = {
  parse(raw: string): ParsedScan {
    const text = (raw || "").trim();
    if (!text) return { type: "unknown", raw };

    // New URL deep-links (what a native camera opens): ".../join/<id>" and
    // ".../checkin/<id>". Checked first so a scanned poster URL classifies even
    // though it contains '.' (the domain) and isn't JSON.
    const joinUrl = text.match(new RegExp(`/join/(${UUID_RE.source})`, "i"));
    if (joinUrl) return { type: QR_TYPES.JOIN, gymId: joinUrl[1] };
    const checkinUrl = text.match(new RegExp(`/checkin/(${UUID_RE.source})`, "i"));
    if (checkinUrl) return { type: QR_TYPES.WALL, gymId: checkinUrl[1] };

    // Signed member pass: "<base64payload>.<hexsig>"
    if (text.includes(".") && !text.startsWith("{")) {
      const [b64] = text.split(".");
      const { mid, gid, exp } = decodeSignedPayload(b64);
      if (mid) {
        return {
          type: QR_TYPES.MEMBER_PASS,
          token: text,
          signed: true,
          memberId: mid,
          gymId: gid,
          expired: exp != null && exp * 1000 < Date.now(),
        };
      }
      return { type: "unknown", raw };
    }

    // JSON payloads: join poster, wall poster, or legacy member pass.
    if (text.startsWith("{")) {
      try {
        const obj = JSON.parse(text) as { action?: string; gym_id?: string; member_id?: string };
        if (obj.action === "join" && typeof obj.gym_id === "string") {
          return { type: QR_TYPES.JOIN, gymId: obj.gym_id.trim() };
        }
        if (typeof obj.member_id === "string" && obj.member_id.trim()) {
          return {
            type: QR_TYPES.MEMBER_PASS,
            token: text,
            signed: false,
            memberId: obj.member_id.trim(),
            gymId: typeof obj.gym_id === "string" ? obj.gym_id.trim() : null,
            expired: false,
          };
        }
        if (typeof obj.gym_id === "string" && obj.gym_id.trim()) {
          return { type: QR_TYPES.WALL, gymId: obj.gym_id.trim() };
        }
      } catch {
        return { type: "unknown", raw };
      }
      return { type: "unknown", raw };
    }

    // Bare UUID: legacy member pass.
    const m = text.match(UUID_RE);
    if (m) {
      return {
        type: QR_TYPES.MEMBER_PASS,
        token: text,
        signed: false,
        memberId: m[0],
        gymId: null,
        expired: false,
      };
    }

    return { type: "unknown", raw };
  },

  /** Convenience for wall/join scanners that only need the gym id. */
  extractGymId(raw: string): string | null {
    const parsed = QRValidator.parse(raw);
    if (parsed.type === QR_TYPES.WALL || parsed.type === QR_TYPES.JOIN) return parsed.gymId;
    return null;
  },
};
