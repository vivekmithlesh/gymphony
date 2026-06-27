// =============================================================================
// Global authentication context — the single source of truth for "who is signed
// in" across the whole app.
// -----------------------------------------------------------------------------
// Before this, ~20 components each called supabase.auth.getSession()/getUser()
// independently and the root re-subscribed to onAuthStateChange on every
// navigation. This provider subscribes ONCE, keeps session/user/role live
// (logins, logouts, token refreshes, and cross-tab changes via the Supabase
// client's storage sync), and exposes them through useAuth().
//
// SSR note (TanStack Start): all Supabase calls run inside useEffect, never at
// render/module load, so there is no `window`/session access on the server.
// Initial render is isLoading=true on both server and client → no hydration
// mismatch.
// =============================================================================

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/supabase";
import { resolveUserRole, type UserRole } from "@/lib/auth-role";
import { logLoginEvent, isAdminEmail } from "@/lib/platform-admin";

// Dedup key: we record a login row once per access token. A real sign-in mints a
// new token (logged once); tab refocus can re-fire SIGNED_IN with the SAME token
// (skipped). Token refreshes fire TOKEN_REFRESHED — not SIGNED_IN — so they never
// log. Scoped to sessionStorage (per tab) and guarded for SSR/quota errors.
const LOGIN_LOGGED_TOKEN_KEY = "gymphony:last_login_logged_token";

function recordLoginOnce(token: string | undefined) {
  if (!token) return;
  try {
    if (sessionStorage.getItem(LOGIN_LOGGED_TOKEN_KEY) === token) return;
    sessionStorage.setItem(LOGIN_LOGGED_TOKEN_KEY, token);
  } catch {
    // sessionStorage unavailable (SSR/private mode) — fall through and log once.
  }
  void logLoginEvent();
}

interface AuthContextValue {
  /** The current Supabase session, or null when signed out. */
  session: Session | null;
  /** Convenience accessor for session.user. */
  user: User | null;
  /** "owner" | "member" | null — resolved from the DB after sign-in. */
  role: UserRole | null;
  /** True when the signed-in user is a platform admin (profiles.is_platform_admin). */
  isPlatformAdmin: boolean;
  /**
   * True until the FIRST session check resolves. Gate UI on this to avoid the
   * flicker of rendering a logged-out view before Supabase confirms the session.
   */
  isLoading: boolean;
  /**
   * True once role resolution has settled for the current session (false while a
   * signed-in user's role is still being looked up). Logged-out users are
   * considered resolved immediately.
   */
  roleResolved: boolean;
  /** Sign out and clear the session everywhere. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [role, setRole] = useState<UserRole | null>(null);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [roleResolved, setRoleResolved] = useState(false);

  // Monotonic token so a slow role lookup from a stale session can never
  // overwrite the role of a newer one (rapid sign-in/out, token refresh races).
  const applyToken = useRef(0);

  useEffect(() => {
    let active = true;

    const applySession = async (nextSession: Session | null) => {
      const token = ++applyToken.current;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      // The session itself is now known — unblock UI immediately; role can
      // settle a beat later without holding the whole app on a loader.
      setIsLoading(false);

      if (!nextSession?.user) {
        setRole(null);
        setIsPlatformAdmin(false);
        setRoleResolved(true);
        return;
      }

      setRoleResolved(false);
      try {
        const [resolved, adminRes] = await Promise.all([
          resolveUserRole(nextSession.user),
          supabase.from("profiles").select("is_platform_admin").eq("id", nextSession.user.id).maybeSingle(),
        ]);
        if (!active || token !== applyToken.current) return; // superseded
        setRole(resolved);
        // Flag (server-managed) OR the hardcoded platform-owner email. Mirrors the
        // is_platform_admin() SQL gate so the panel renders for that email even
        // when the DB flag isn't set. Server still enforces every admin read.
        setIsPlatformAdmin(
          Boolean(adminRes.data?.is_platform_admin) || isAdminEmail(nextSession.user.email),
        );
      } catch (err) {
        if (!active || token !== applyToken.current) return;
        console.warn("[Auth] role resolution failed:", err);
        setRole(null);
        setIsPlatformAdmin(isAdminEmail(nextSession.user.email));
      } finally {
        if (active && token === applyToken.current) setRoleResolved(true);
      }
    };

    // 1. Seed from the persisted session on mount.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (active) void applySession(data.session);
      })
      .catch((err) => {
        console.warn("[Auth] getSession failed:", err);
        if (active) {
          setIsLoading(false);
          setRoleResolved(true);
        }
      });

    // 2. Stay live for logins, logouts, and token refreshes (and cross-tab
    //    changes, which the Supabase client mirrors into this listener).
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      void applySession(nextSession);
      // Audit only genuine sign-ins (not INITIAL_SESSION / TOKEN_REFRESHED).
      if (event === "SIGNED_IN") {
        recordLoginOnce(nextSession?.access_token);
      } else if (event === "SIGNED_OUT") {
        try {
          sessionStorage.removeItem(LOGIN_LOGGED_TOKEN_KEY);
        } catch {
          /* ignore */
        }
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    // onAuthStateChange will fire SIGNED_OUT and reset state; set eagerly too so
    // callers see the change synchronously.
    setSession(null);
    setUser(null);
    setRole(null);
    setIsPlatformAdmin(false);
    setRoleResolved(true);
  };

  return (
    <AuthContext.Provider
      value={{ session, user, role, isPlatformAdmin, isLoading, roleResolved, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

/** Access the global auth state. Must be used within <AuthProvider>. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (ctx === undefined) {
    throw new Error("useAuth must be used within <AuthProvider>");
  }
  return ctx;
}
