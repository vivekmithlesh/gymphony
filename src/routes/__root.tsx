import { Outlet, Link, createRootRoute, HeadContent, Scripts, useNavigate, useRouterState } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase";
import { getDashboardPathForRole, resolveUserRole } from "@/lib/auth-role";

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

function RootComponent() {
  const navigate = useNavigate();
  const routerState = useRouterState();
  const [session, setSession] = useState<any>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);

  useEffect(() => {
    const handleRedirects = async (currentSession: any, currentPath: string) => {
      const isOwnerAuthPage = currentPath === "/signup" || currentPath === "/login";
      const isMemberAuthPage = currentPath === "/member-login";
      const isOwnerProtected = currentPath.startsWith("/dashboard") || currentPath === "/city-leaderboard" || currentPath === "/kiosk" || currentPath === "/kiosk-mode";
      const isMemberProtected = currentPath.startsWith("/member-dashboard");
      const isLandingPage = currentPath === "/";

      if (currentSession) {
        const role = await resolveUserRole(currentSession.user);

        if (role === "member") {
          const target = getDashboardPathForRole(role);
          if (isOwnerAuthPage || isMemberAuthPage || isOwnerProtected || isLandingPage) {
            console.log("Auth: Redirecting member to member-dashboard");
            navigate({ to: target, replace: true });
          }
        } else if (role === "owner") {
          const target = getDashboardPathForRole(role);
          if (isOwnerAuthPage || isMemberAuthPage || isMemberProtected || isLandingPage) {
            console.log("Auth: Redirecting owner to dashboard");
            navigate({ to: target, replace: true });
          }
        }
      } else {
        if (isOwnerProtected) {
          console.log("Auth: Redirecting logged-out user to login");
          navigate({ to: "/login", replace: true });
        } else if (isMemberProtected) {
          console.log("Auth: Redirecting logged-out member to member-login");
          navigate({ to: "/member-login", replace: true });
        }
      }
    };

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsAuthChecking(false);
      void handleRedirects(session, routerState.location.pathname);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      
      if (event === 'SIGNED_IN' && session) {
        void (async () => {
          const role = await resolveUserRole(session.user);
          if (role === "member" || role === "owner") {
            const target = getDashboardPathForRole(role);
            console.log(`Auth: SIGNED_IN detected, navigating to ${target}`);
            navigate({ to: target, replace: true });
          }
        })();
      } else {
        void handleRedirects(session, routerState.location.pathname);
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, routerState.location.pathname]);

  if (isAuthChecking) return null;

  return (
    <>
      <Outlet />
      <Toaster position="bottom-center" richColors />
    </>
  );
}
