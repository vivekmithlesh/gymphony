import { endOfMonth, startOfDay, startOfMonth, subMinutes } from "date-fns";
import { prisma } from "@/server/db";
import { emitNotification, NOTIFICATION_TYPES } from "@/server/services/notification.service";
import type { AttendanceListResponse } from "@/types/gym.types";

/** Visit counts that trigger a milestone celebration notification. */
const ATTENDANCE_MILESTONES = new Set([10, 25, 50, 100, 250, 500]);

function buildAvatar(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

/**
 * Returns all active members with their attendance dates for current month
 */
export async function getAttendanceForGym(gymId: string): Promise<AttendanceListResponse> {
  const monthStart = startOfMonth(new Date());
  const monthEnd = endOfMonth(new Date());
  const todayStart = startOfDay(new Date());

  const [memberships, liveCount] = await Promise.all([
    prisma.membership.findMany({
      where: {
        gymId,
        memberUser: {
          isActive: true,
        },
      },
      orderBy: {
        memberUser: {
          fullName: "asc",
        },
      },
      select: {
        memberUserId: true,
        planName: true,
        memberUser: {
          select: {
            fullName: true,
          },
        },
      },
    }),
    prisma.attendanceSession.count({
      where: {
        gymId,
        checkInAt: {
          gte: todayStart,
        },
      },
    }),
  ]);

  const attendanceSessions = await prisma.attendanceSession.findMany({
    where: {
      gymId,
      checkInAt: {
        gte: monthStart,
        lte: monthEnd,
      },
    },
    orderBy: {
      checkInAt: "asc",
    },
    select: {
      memberUserId: true,
      checkInAt: true,
    },
  });

  const dateMap = new Map<string, string[]>();

  for (const session of attendanceSessions) {
    const dates = dateMap.get(session.memberUserId) ?? [];
    dates.push(session.checkInAt.toISOString());
    dateMap.set(session.memberUserId, dates);
  }

  return {
    members: memberships.map((membership) => ({
      id: membership.memberUserId,
      name: membership.memberUser.fullName,
      plan: membership.planName,
      avatar: buildAvatar(membership.memberUser.fullName),
      dates: dateMap.get(membership.memberUserId) ?? [],
    })),
    liveCount,
  };
}

/**
 * Records a check-in via QR scan.
 * Validates member belongs to gym.
 * Prevents duplicate check-ins same day.
 */
export async function recordCheckIn(
  gymId: string,
  memberUserId: string,
): Promise<{ success: boolean; message: string }> {
  const now = new Date();
  const [memberMembership, gymSetting] = await Promise.all([
    prisma.membership.findFirst({
      where: {
        gymId,
        memberUserId,
        memberUser: {
          isActive: true,
        },
      },
      select: {
        memberUserId: true,
        memberUser: {
          select: {
            fullName: true,
          },
        },
      },
    }),
    prisma.gymSetting.findUnique({
      where: { gymId },
      select: { attendanceCooldownMinutes: true },
    }),
  ]);

  if (!memberMembership) {
    return {
      success: false,
      message: "Member does not belong to this gym",
    };
  }

  // Configurable cooldown: blocks duplicate check-ins within the window.
  // 0 falls back to once-per-calendar-day.
  const cooldownMinutes = gymSetting?.attendanceCooldownMinutes ?? 360;
  const cooldownStart = cooldownMinutes > 0 ? subMinutes(now, cooldownMinutes) : startOfDay(now);

  const existingCheckIn = await prisma.attendanceSession.findFirst({
    where: {
      gymId,
      memberUserId,
      checkInAt: {
        gte: cooldownStart,
      },
    },
    select: {
      id: true,
    },
  });

  if (existingCheckIn) {
    return {
      success: false,
      message:
        cooldownMinutes > 0
          ? `Already checked in. Please wait before checking in again.`
          : "Member is already checked in for today",
    };
  }

  await prisma.attendanceSession.create({
    data: {
      gymId,
      memberUserId,
      checkInAt: now,
    },
    select: {
      id: true,
    },
  });

  await emitNotification({
    gymId,
    text: `${memberMembership.memberUser.fullName} checked in`,
    type: NOTIFICATION_TYPES.ATTENDANCE,
    color: "text-sky-400",
  });

  // Attendance milestone celebration (10 / 25 / 50 / 100 ... lifetime visits).
  const totalVisits = await prisma.attendanceSession.count({
    where: { gymId, memberUserId },
  });

  if (ATTENDANCE_MILESTONES.has(totalVisits)) {
    await emitNotification({
      gymId,
      text: `🎉 ${memberMembership.memberUser.fullName} reached ${totalVisits} check-ins!`,
      type: NOTIFICATION_TYPES.MEMBER,
      color: "text-amber-400",
    });
  }

  return {
    success: true,
    message: "Check-in recorded successfully",
  };
}
