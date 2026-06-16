import { Outlet, Link, createRootRoute, HeadContent, Scripts, useNavigate, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useEffect } from "react";
import { getDashboardPathForRole } from "@/lib/auth-role";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { postAuthDestination } from "@/lib/auth-redirect";
import { logEvent } from "@/lib/logger";

import appCss from "../styles.css?url";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Gymphony — Modern Gym Management Platform" },
      { name: "description", content: "Automate payments, track attendance, and get discovered by new members—all in one premium platform built for ambitious gym owners." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body style={{ margin: 0, padding: 0, width: '100%', height: '100%', backgroundColor: '#F9FAFB' }}>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

// Cross-cutting redirect rules — the single source of truth for "where should
// this session be allowed". Reads the shared auth context (no per-navigation
// re-subscribe), and reacts to both auth changes and route changes.
function AuthRedirects() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const { session, role, isLoading, roleResolved } = useAuth();

  const currentPath = routerState.location.pathname;

  useEffect(() => {
    if (isLoading) return;

    const isOwnerAuthPage = currentPath === "/signup" || currentPath === "/login";
    const isMemberAuthPage = currentPath === "/member-login";
    const isOwnerProtected =
      currentPath.startsWith("/dashboard") ||
      currentPath === "/city-leaderboard" ||
      currentPath === "/kiosk" ||
      currentPath === "/kiosk-mode";
    const isMemberProtected = currentPath.startsWith("/member-dashboard");
    const isLandingPage = currentPath === "/";

    if (session) {
      // Wait for role to settle before deciding owner-vs-member destinations.
      if (!roleResolved) return;

      // If the user authenticated from a QR deep-link, honour that destination
      // before the default dashboard routing. A real navigation guarantees the
      // dynamic target (e.g. /checkin/:id) loads regardless of router typing.
      if (isOwnerAuthPage || isMemberAuthPage) {
        const target = postAuthDestination();
        if (target) {
          logEvent("auth", "redirect-resume", { target });
          if (typeof window !== "undefined") window.location.assign(target);
          return;
        }
      }

      if (role === "member") {
        const target = getDashboardPathForRole(role);
        if (isOwnerAuthPage || isMemberAuthPage || isOwnerProtected || isLandingPage) {
          navigate({ to: target, replace: true });
        }
      } else if (role === "owner") {
        const target = getDashboardPathForRole(role);
        if (isOwnerAuthPage || isMemberAuthPage || isMemberProtected || isLandingPage) {
          navigate({ to: target, replace: true });
        }
      }
    } else {
      if (isOwnerProtected) {
        navigate({ to: "/login", replace: true });
      } else if (isMemberProtected) {
        navigate({ to: "/member-login", replace: true });
      }
    }
  }, [session, role, isLoading, roleResolved, currentPath, navigate]);

  return null;
}

function RootContent() {
  const { isLoading } = useAuth();

  // Block the first paint until the session check resolves — prevents the
  // logged-out-then-logged-in flicker (parity with the old isAuthChecking gate).
  if (isLoading) return null;

  return (
    <>
      <AuthRedirects />
      <Outlet />
      <Toaster position="bottom-center" richColors />
    </>
  );
}

function RootComponent() {
  return (
    <AuthProvider>
      <RootContent />
    </AuthProvider>
  );
}
