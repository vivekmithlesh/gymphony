import { emitNotification } from "@/server/services/notification.service";
import type { NotificationJobData } from "@/server/jobs/job-types";

/**
 * Persists a notification produced by a background job. Delegates to the
 * shared notification service so inline and queued notifications behave
 * identically (same persistence + cache invalidation).
 */
export async function createNotificationRecord(data: NotificationJobData): Promise<void> {
  await emitNotification({
    gymId: data.gymId,
    text: data.text,
    type: data.type,
    color: data.color,
  });
}
