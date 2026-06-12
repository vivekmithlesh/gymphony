// =============================================================================
// ProtectedRoute — per-route auth guard built on the global AuthProvider.
// -----------------------------------------------------------------------------
// Wrap a route's component to require a signed-in user (optionally of a specific
// role). While the session is still resolving it shows <PremiumLoader/> (no
// flicker); an unauthenticated user is sent to the correct login page; a user of
// the wrong role is sent to their own dashboard.
//
// The root <AuthRedirects/> already enforces these rules globally; this wrapper
// is defence-in-depth + the loading UX for individual protected screens. Both
// derive their decision from the same useAuth() state, so they always agree —
// a duplicate navigate() to the same target (replace) is harmless.
//
//   <ProtectedRoute requiredRole="owner"><Dashboard /></ProtectedRoute>
// =============================================================================

import { useEffect, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-context";
import { getDashboardPathForRole, type UserRole } from "@/lib/auth-role";
import { PremiumLoader } from "@/components/PremiumLoader";

interface ProtectedRouteProps {
  /** If set, the signed-in user must have this role or they're sent to theirs. */
  requiredRole?: UserRole;
  children: ReactNode;
}

export function ProtectedRoute({ requiredRole, children }: ProtectedRouteProps) {
  const navigate = useNavigate();
  const { session, role, isLoading, roleResolved } = useAuth();

  const loginPath = requiredRole === "member" ? "/member-login" : "/login";
  const wrongRole =
    Boolean(requiredRole) && roleResolved && role !== null && role !== requiredRole;

  useEffect(() => {
    if (isLoading || !roleResolved) return;

    if (!session) {
      navigate({ to: loginPath, replace: true });
    } else if (wrongRole && role) {
      navigate({ to: getDashboardPathForRole(role), replace: true });
    }
  }, [isLoading, roleResolved, session, wrongRole, role, loginPath, navigate]);

  // Still resolving, or about to redirect — show the premium loader rather than
  // briefly flashing protected content.
  if (isLoading || !roleResolved || !session || wrongRole) {
    return <PremiumLoader title="Checking your session" subtext="One moment…" />;
  }

  return <>{children}</>;
}

export default ProtectedRoute;
