import { createServerFn } from "@tanstack/react-start";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { getOwnerInsights } from "@/server/services/insights.service";

export const dashboardInsights = createServerFn({ method: "GET" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN, USER_ROLES.STAFF)])
  .handler(async ({ context }) => {
    return getOwnerInsights(context.session.gymId);
  });
