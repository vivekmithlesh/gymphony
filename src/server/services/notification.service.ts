import { cacheKeys, redisCache } from "@/server/cache";
import { prisma } from "@/server/db";

/**
 * Notification event types. Keep these in sync with the icon/colour maps used
 * in the owner dashboard so each event renders with the right affordance.
 */
export const NOTIFICATION_TYPES = {
  MEMBER: "member",
  PAYMENT: "payment",
  ATTENDANCE: "attendance",
  RENEWAL: "renewal",
  EXPIRED: "expired",
  STAFF: "staff",
  LEAD: "lead",
  SYSTEM: "system",
  ALERT: "alert",
} as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export interface EmitNotificationInput {
  gymId: string;
  text: string;
  type: NotificationType | string;
  color: string;
}

/**
 * Persists an in-app notification and invalidates the cached dashboard summary
 * so the owner sees it on the next poll.
 *
 * Notifications are best-effort: a failure here must never break the business
 * action that triggered it (a check-in, payment, signup, etc.), so callers can
 * `void emitNotification(...)` and we swallow/log errors internally.
 */
export async function emitNotification(input: EmitNotificationInput): Promise<void> {
  try {
    await prisma.notification.create({
      data: {
        gymId: input.gymId,
        text: input.text,
        timeLabel: "just now",
        type: input.type,
        color: input.color,
      },
    });

    await redisCache.del(cacheKeys.dashboard(input.gymId));
  } catch (error) {
    console.error("[notifications] Failed to emit notification", {
      gymId: input.gymId,
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Returns the count of unread notifications for a gym (used for the badge).
 */
export async function getUnreadNotificationCount(gymId: string): Promise<number> {
  return prisma.notification.count({
    where: {
      gymId,
      readAt: null,
    },
  });
}

/**
 * Marks a single notification as read. Scoped to the gym to prevent
 * cross-tenant access.
 */
export async function markNotificationRead(gymId: string, notificationId: number): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      id: notificationId,
      gymId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  await redisCache.del(cacheKeys.dashboard(gymId));
}

/**
 * Marks every unread notification for a gym as read.
 */
export async function markAllNotificationsRead(gymId: string): Promise<void> {
  await prisma.notification.updateMany({
    where: {
      gymId,
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });

  await redisCache.del(cacheKeys.dashboard(gymId));
}
