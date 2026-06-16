import { createServerFn } from "@tanstack/react-start";
import { getSessionFromCookie } from "@/lib/auth-helpers";

/**
 * Lightweight session probe for the public Join Gym page. Lets the client
 * decide whether to show the signup form or jump straight to plan enrollment,
 * without exposing the session token.
 */
export const joinSession = createServerFn({ method: "GET" }).handler(async () => {
  const session = await getSessionFromCookie();

  if (!session) {
    return { authenticated: false as const };
  }

  return {
    authenticated: true as const,
    role: session.role,
    gymId: session.gymId,
  };
});
