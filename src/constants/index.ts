/** Centralized backend constants and runtime-safe magic values. */

/** OTP purpose constants for auth flows. */
export const OTP_PURPOSES = {
  OWNER_SIGNUP: "OWNER_SIGNUP",
  MEMBER_LOGIN: "MEMBER_LOGIN",
  MEMBER_SIGNUP: "MEMBER_SIGNUP",
} as const;

/** OTP expiration window in minutes. */
export const OTP_EXPIRY_MINUTES = 10;

/** OTP expiration window in seconds. */
export const OTP_EXPIRY_SECONDS = OTP_EXPIRY_MINUTES * 60;

/** Session expiration window in days. */
export const SESSION_EXPIRY_DAYS = 7;

/** Session expiration window in seconds. */
export const SESSION_EXPIRY_SECONDS = SESSION_EXPIRY_DAYS * 24 * 60 * 60;

/** Cache time-to-live values in seconds. */
export const CACHE_TTL_SECONDS = {
  DASHBOARD: 60,
  MEMBER: 300,
  LEADERBOARD: 120,
} as const;

/** OTP rate-limit configuration. */
export const OTP_RATE_LIMITS = {
  MAX_REQUESTS_PER_HOUR: 3,
  WINDOW_SECONDS: 60 * 60,
} as const;

/** Slow Prisma query threshold in milliseconds. */
export const SLOW_QUERY_THRESHOLD_MS = 300;

export * from "./roles";
export * from "./status";
