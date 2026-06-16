import { createServerFn } from "@tanstack/react-start";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { getUnreadNotificationCount } from "@/server/services/notification.service";

export const notificationsUnreadCount = createServerFn({ method: "GET" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN, USER_ROLES.STAFF)])
  .handler(async ({ context }): Promise<{ count: number }> => {
    const count = await getUnreadNotificationCount(context.session.gymId);
    return { count };
  });
