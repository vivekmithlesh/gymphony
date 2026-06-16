import { USER_ROLES } from "@/constants";
import type { UserRole } from "@/types/auth.types";

/**
 * Pure (client-safe) helper that maps a role to its post-auth landing route.
 * Kept out of auth-helpers.ts so route files can import it without pulling in
 * the server-only `@tanstack/react-start/server` module.
 */
export function getRedirectForRole(role: UserRole): "/dashboard" | "/member-dashboard" {
  return role === USER_ROLES.MEMBER ? "/member-dashboard" : "/dashboard";
}
