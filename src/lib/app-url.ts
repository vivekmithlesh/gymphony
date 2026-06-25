// =============================================================================
// app-url — canonical, SSR-safe helpers for building and parsing the public QR
// deep-links that drive onboarding and attendance.
// -----------------------------------------------------------------------------
// The whole point of a QR poster is that ANY phone camera can scan it and land
// the user in the right place. That only works if the QR encodes a real URL —
// not an app-private JSON payload. So join/check-in posters now encode:
//   • Join QR     → {origin}/join/{gym_id}
//   • Check-in QR → {origin}/checkin/{gym_id}
//
// `getAppOrigin()` is BROWSER-FIRST: the owner mints QR/invite links from the
// real production domain they're viewing, so links auto-follow a domain change
// (e.g. a Vercel project rename) with no env edit + redeploy dance. It falls back
// to the configured build-time origin ONLY for localhost/dev and SSR, so a link
// generated locally still points at production. Parsing is tolerant: it reads the
// gym id from the new URL form AND the legacy JSON/bare-uuid forms.
// =============================================================================

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i;

/** The public base origin used when minting QR deep-links (no trailing slash). */
export function getAppOrigin(): string {
  // Prefer the live browser origin unless we're on localhost/dev — that way the
  // QR encodes whatever domain the owner is actually on (the current production
  // host), instead of a stale build-time value.
  if (typeof window !== "undefined" && window.location?.origin) {
    const origin = window.location.origin.replace(/\/+$/, "");
    if (!LOCAL_ORIGIN_RE.test(origin)) return origin;
  }

  const env = import.meta.env as Record<string, string | undefined>;
  const configured = (
    env.VITE_APP_URL ||
    env.VITE_PUBLIC_SITE_URL ||
    env.VITE_SITE_URL ||
    ""
  ).trim();
  if (configured) return configured.replace(/\/+$/, "");
  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }
  return "";
}

/** Full deep-link a new member scans to join a gym + pick a plan. */
export function buildJoinUrl(gymId: string): string {
  return `${getAppOrigin()}/join/${gymId}`;
}

/** Full deep-link a member scans on the wall to check in (attendance). */
export function buildCheckinUrl(gymId: string): string {
  return `${getAppOrigin()}/checkin/${gymId}`;
}

export type GymQrKind = "join" | "checkin" | "gym" | null;

export interface ParsedGymQr {
  kind: GymQrKind;
  gymId: string | null;
}

/**
 * Read the intent + gym id out of any gym poster: the new URL form
 * (`…/join/<id>`, `…/checkin/<id>`), the legacy JSON form
 * (`{"action":"join","gym_id":…}` / `{"gym_id":…}`), or a bare UUID. Returns
 * `{ kind: null, gymId: null }` for anything unrecognized.
 */
export function parseGymQr(raw: string): ParsedGymQr {
  const text = (raw || "").trim();
  if (!text) return { kind: null, gymId: null };

  // New URL form — what a native camera now opens.
  const joinUrl = text.match(new RegExp(`/join/(${UUID_RE.source})`, "i"));
  if (joinUrl) return { kind: "join", gymId: joinUrl[1] };
  const checkinUrl = text.match(new RegExp(`/checkin/(${UUID_RE.source})`, "i"));
  if (checkinUrl) return { kind: "checkin", gymId: checkinUrl[1] };

  // Legacy JSON form (older posters + in-app scanner payloads).
  if (text.startsWith("{")) {
    try {
      const obj = JSON.parse(text) as { action?: string; gym_id?: string };
      if (typeof obj.gym_id === "string" && obj.gym_id.trim()) {
        return { kind: obj.action === "join" ? "join" : "gym", gymId: obj.gym_id.trim() };
      }
    } catch {
      /* not JSON — fall through */
    }
  }

  // Bare UUID — treat as a gym reference (used by very old posters).
  const bare = text.match(UUID_RE);
  if (bare) return { kind: "gym", gymId: bare[0] };

  return { kind: null, gymId: null };
}

/** Convenience: just the gym id from any gym poster, or null. */
export function extractGymIdFromQr(raw: string): string | null {
  return parseGymQr(raw).gymId;
}
