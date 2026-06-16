// =============================================================================
// logger — tiny structured client-side logger for the onboarding/attendance
// pipeline. Requirement: log QR scans, auth redirects, membership creation,
// attendance creation, and payment success/failure.
// -----------------------------------------------------------------------------
// This is the CLIENT half (visible in the browser console + any console-capturing
// error tool). The authoritative, durable audit trail lives server-side in the
// `qr_scans` and `activity_log` tables, written by the SECURITY DEFINER RPCs.
// Kept dependency-free so it is safe to call from anywhere (incl. SSR).
// =============================================================================

export type LogScope = "qr" | "auth" | "membership" | "attendance" | "payment";

/** Structured, scope-tagged log line. Never throws. */
export function logEvent(scope: LogScope, event: string, data?: Record<string, unknown>): void {
  try {
    console.info(`[gymphony:${scope}] ${event}`, data ?? {});
  } catch {
    /* console unavailable — ignore */
  }
}
