// =============================================================================
// International phone helpers (legacy). The app standardises on Indian mobiles
// (see the India-only section below); these remain only to validate / format
// numbers that are ALREADY stored in E.164 — e.g. RetentionWidget building a
// wa.me link from a member's saved number.
// =============================================================================
export const INTERNATIONAL_PHONE_REGEX = /^\+?[1-9]\d{6,14}$/;

export const cleanPhoneInput = (value?: string) => {
  return (value || "").trim().replace(/[()\s-]/g, "");
};

export const isValidInternationalPhone = (value?: string) => {
  const cleaned = cleanPhoneInput(value);
  return INTERNATIONAL_PHONE_REGEX.test(cleaned);
};

export const phoneForWaMe = (value?: string) => {
  const cleaned = cleanPhoneInput(value);
  return cleaned.startsWith("+") ? cleaned.slice(1) : cleaned;
};

// =============================================================================
// India-only mobile validation (product rule: exactly 10 digits, starts 6–9).
// The app standardises on Indian numbers; storage stays E.164 (+91XXXXXXXXXX)
// so WhatsApp/login lookups keep working, but the UI only ever accepts the
// 10-digit local number. These are the single source of truth for that rule.
// =============================================================================
export const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

/**
 * Reduce any messy input to its canonical 10-digit Indian local number:
 * strips spaces/dashes/parens, drops a leading +91 / 91 / 0 trunk prefix.
 * "+91 98765-43210", "09876543210" and "9876543210" all collapse to
 * "9876543210". Returns digits-only (may be <10 while the user is still typing).
 */
export const toIndianLocal = (value?: string): string => {
  let digits = (value || "").replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) digits = digits.slice(2);
  else if (digits.length === 11 && digits.startsWith("0")) digits = digits.slice(1);
  return digits;
};

/**
 * STRICT form validator: the value must be EXACTLY 10 digits (starting 6–9) and
 * nothing else — no +91, no spaces, no dashes, no letters. This is what the
 * signup/onboarding fields enforce (the input box already strips non-digits, so
 * the field value is always clean by the time it gets here).
 */
export const isValidIndianMobile = (value?: string): boolean =>
  INDIAN_MOBILE_REGEX.test((value || "").trim());

/**
 * LENIENT recogniser for places where a user may type their number with a
 * prefix (e.g. the login box: "+91 98765 43210" or "09876543210"). Strips the
 * prefix/formatting first. Use this to DECIDE if an identifier is a mobile —
 * not to validate a form field.
 */
export const looksLikeIndianMobile = (value?: string): boolean =>
  INDIAN_MOBILE_REGEX.test(toIndianLocal(value));

/** Canonical storage form (+91XXXXXXXXXX), or "" if the input isn't valid. */
export const toIndianE164 = (value?: string): string => {
  const local = toIndianLocal(value);
  return INDIAN_MOBILE_REGEX.test(local) ? `+91${local}` : "";
};

/** What the 10-digit input box should display: digits only, capped at 10. */
export const formatIndianLocalInput = (value?: string): string =>
  toIndianLocal(value).slice(0, 10);
