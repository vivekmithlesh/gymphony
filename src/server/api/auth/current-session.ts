import { createServerFn } from "@tanstack/react-start";
import { getSessionFromCookie } from "@/lib/auth-helpers";
import type { SessionPayload } from "@/types/auth.types";

/**
 * Server-function bridge for reading the current session from route guards.
 *
 * Route `beforeLoad` runs on both the server and the client, so it must not
 * import server-only modules directly (Vite import-protection blocks that and
 * breaks the production build). Calling this RPC keeps the cookie/JWT logic on
 * the server while remaining safe to invoke from isomorphic guards.
 */
export const currentSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<SessionPayload | null> => {
    return getSessionFromCookie();
  },
);
