// =============================================================================
// auth-redirect — "save the intended destination, return to it after sign-in".
// -----------------------------------------------------------------------------
// When a logged-out user opens a QR deep-link (/join/:id or /checkin/:id) we
// must not silently drop them on a dashboard after they authenticate — they
// scanned that poster for a reason. The gate stashes the intended path (URL
// query param + sessionStorage as a durable backup that survives an OAuth
// round-trip) and the auth pages consume it on success.
//
// `isSafeRedirectPath` is the security boundary: only same-origin, absolute
// in-app paths are honoured, so a crafted ?redirect=https://evil.com or
// //evil.com can never turn our login into an open redirect.
// =============================================================================

export const REDIRECT_PARAM = "redirect";
const STORAGE_KEY = "gymphony.postAuthRedirect";

/**
 * True only for an in-app destination: a single leading slash, no scheme, no
 * protocol-relative `//host`, no backslash tricks. Everything else is rejected.
 */
export function isSafeRedirectPath(path: string | null | undefined): path is string {
  if (!path || typeof path !== "string") return false;
  if (!path.startsWith("/")) return false; // must be an absolute in-app path
  if (path.startsWith("//") || path.startsWith("/\\")) return false; // protocol-relative
  if (path.includes("://")) return false; // absolute URL with a scheme
  return true;
}

/** Persist the intended destination so it survives the trip through auth. */
export function saveRedirect(path: string): void {
  if (!isSafeRedirectPath(path)) return;
  try {
    if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    /* storage unavailable (private mode / SSR) — the URL param still carries it */
  }
}

/**
 * Resolve the post-auth destination once, preferring an explicit `?redirect=`
 * param over the stored backup, and CLEAR the backup so it fires exactly once.
 * Returns a validated in-app path, or null when there's nothing safe to honour.
 */
export function consumeRedirect(paramValue?: string | null): string | null {
  let stored: string | null = null;
  try {
    if (typeof window !== "undefined") {
      stored = window.sessionStorage.getItem(STORAGE_KEY);
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
  const candidate = paramValue && paramValue.trim() ? paramValue : stored;
  return isSafeRedirectPath(candidate) ? candidate : null;
}

/** Read the `redirect` query param off the current URL (browser-only). */
export function readRedirectParam(): string | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get(REDIRECT_PARAM);
  return value && value.trim() ? value : null;
}

/**
 * The post-auth destination for THIS page load, if any: the `?redirect=` param
 * (preferred) or the stored backup. Consumes the backup so it fires once. Returns
 * a validated in-app path or null (→ caller falls back to the default dashboard).
 */
export function postAuthDestination(): string | null {
  return consumeRedirect(readRedirectParam());
}

/** Build a login URL that carries the intended destination back through auth. */
export function buildAuthUrlWithRedirect(base: string, redirectPath: string): string {
  if (!isSafeRedirectPath(redirectPath)) return base;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${REDIRECT_PARAM}=${encodeURIComponent(redirectPath)}`;
}
