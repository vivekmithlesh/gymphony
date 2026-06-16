import { createServerFn } from "@tanstack/react-start";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { getAttendanceAnalytics } from "@/server/services/attendance-analytics.service";

export const attendanceAnalytics = createServerFn({ method: "GET" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN, USER_ROLES.STAFF)])
  .handler(async ({ context }) => {
    return getAttendanceAnalytics(context.session.gymId);
  });
