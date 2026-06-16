import { getRequest } from "@tanstack/react-start/server";
import { parse } from "cookie-es";
import { verifySessionToken } from "@/server/auth/session";
import type { SessionPayload } from "@/types/auth.types";

const SESSION_COOKIE_NAME = "gym_session";

export async function getSessionFromCookie(): Promise<SessionPayload | null> {
  const request = getRequest();
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) {
    return null;
  }

  const cookies = parse(cookieHeader);
  const sessionToken = cookies[SESSION_COOKIE_NAME];

  if (!sessionToken) {
    return null;
  }

  return verifySessionToken(sessionToken);
}
