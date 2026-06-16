import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/server/services/notification.service";

const markReadSchema = z.object({
  /** Omit notificationId to mark every notification read. */
  notificationId: z.number().int().positive().optional(),
});

export const notificationsMarkRead = createServerFn({ method: "POST" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN, USER_ROLES.STAFF)])
  .inputValidator(markReadSchema)
  .handler(async ({ context, data }): Promise<{ success: boolean }> => {
    if (data.notificationId) {
      await markNotificationRead(context.session.gymId, data.notificationId);
    } else {
      await markAllNotificationsRead(context.session.gymId);
    }

    return { success: true };
  });
