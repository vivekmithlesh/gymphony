import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { USER_ROLES } from "@/constants";
import { requireRole } from "@/server/auth/middleware";
import { updateAttendanceSettings } from "@/server/services/attendance-analytics.service";

const attendanceSettingsSchema = z.object({
  // 0 = once per calendar day; otherwise the lockout window in minutes.
  cooldownMinutes: z.number().int().min(0).max(1440).optional(),
  lateCheckInHour: z.number().int().min(0).max(23).optional(),
});

export const attendanceSettingsUpdate = createServerFn({ method: "POST" })
  .middleware([requireRole(USER_ROLES.OWNER, USER_ROLES.ADMIN)])
  .inputValidator(attendanceSettingsSchema)
  .handler(async ({ context, data }) => {
    return updateAttendanceSettings(context.session.gymId, data);
  });
