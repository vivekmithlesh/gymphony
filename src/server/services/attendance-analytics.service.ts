import { format, getHours, startOfDay, startOfMonth, subDays } from "date-fns";
import { prisma } from "@/server/db";
import type { AttendanceAnalytics, PeakHourPoint } from "@/types/gym.types";

const DEFAULT_COOLDOWN_MINUTES = 360;
const DEFAULT_LATE_HOUR = 22;
const MOST_ACTIVE_LIMIT = 5;

function buildAvatar(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function formatHourLabel(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

/**
 * Aggregated attendance analytics for the owner dashboard:
 * daily/monthly reports, peak-hour distribution, most-active members,
 * and late check-in detection driven by the gym's configurable late hour.
 */
export async function getAttendanceAnalytics(gymId: string): Promise<AttendanceAnalytics> {
  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const yesterdayStart = subDays(todayStart, 1);

  const [gymSetting, monthSessions, yesterdayCount] = await Promise.all([
    prisma.gymSetting.findUnique({
      where: { gymId },
      select: { attendanceCooldownMinutes: true, lateCheckInHour: true },
    }),
    prisma.attendanceSession.findMany({
      where: { gymId, checkInAt: { gte: monthStart } },
      select: { checkInAt: true, memberUserId: true },
    }),
    prisma.attendanceSession.count({
      where: { gymId, checkInAt: { gte: yesterdayStart, lt: todayStart } },
    }),
  ]);

  const cooldownMinutes = gymSetting?.attendanceCooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES;
  const lateCheckInHour = gymSetting?.lateCheckInHour ?? DEFAULT_LATE_HOUR;

  const hourBuckets = new Array<number>(24).fill(0);
  const activeDays = new Set<string>();
  const monthlyVisitsByMember = new Map<string, number>();

  let lateThisMonth = 0;
  let checkInsToday = 0;
  let lateToday = 0;
  const todayMembers = new Set<string>();

  for (const session of monthSessions) {
    const hour = getHours(session.checkInAt);
    hourBuckets[hour] += 1;
    activeDays.add(format(session.checkInAt, "yyyy-MM-dd"));
    monthlyVisitsByMember.set(
      session.memberUserId,
      (monthlyVisitsByMember.get(session.memberUserId) ?? 0) + 1,
    );

    const isLate = hour >= lateCheckInHour;
    if (isLate) {
      lateThisMonth += 1;
    }

    if (session.checkInAt >= todayStart) {
      checkInsToday += 1;
      todayMembers.add(session.memberUserId);
      if (isLate) {
        lateToday += 1;
      }
    }
  }

  const peakHours: PeakHourPoint[] = hourBuckets.map((value, hour) => ({
    label: formatHourLabel(hour),
    value,
  }));

  const topMemberIds = Array.from(monthlyVisitsByMember.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MOST_ACTIVE_LIMIT);

  const topUsers = topMemberIds.length
    ? await prisma.user.findMany({
        where: { id: { in: topMemberIds.map(([id]) => id) } },
        select: { id: true, fullName: true },
      })
    : [];

  const nameById = new Map(topUsers.map((user) => [user.id, user.fullName]));

  const mostActiveMembers = topMemberIds.map(([id, visits]) => {
    const name = nameById.get(id) ?? "Member";
    return { id, name, avatar: buildAvatar(name), visits };
  });

  const checkInsThisMonth = monthSessions.length;

  return {
    daily: {
      checkInsToday,
      uniqueMembersToday: todayMembers.size,
      lateToday,
      deltaVsYesterday: checkInsToday - yesterdayCount,
    },
    monthly: {
      checkInsThisMonth,
      activeDays: activeDays.size,
      avgPerActiveDay: activeDays.size === 0 ? 0 : Math.round(checkInsThisMonth / activeDays.size),
      lateThisMonth,
    },
    peakHours,
    mostActiveMembers,
    cooldownMinutes,
    lateCheckInHour,
  };
}

/**
 * Updates the gym's configurable attendance controls.
 */
export async function updateAttendanceSettings(
  gymId: string,
  input: { cooldownMinutes?: number; lateCheckInHour?: number },
): Promise<{ success: boolean; message: string }> {
  await prisma.gymSetting.upsert({
    where: { gymId },
    update: {
      ...(input.cooldownMinutes !== undefined
        ? { attendanceCooldownMinutes: input.cooldownMinutes }
        : {}),
      ...(input.lateCheckInHour !== undefined ? { lateCheckInHour: input.lateCheckInHour } : {}),
    },
    create: {
      gymId,
      ownerEmail: "",
      contactNumber: "",
      attendanceCooldownMinutes: input.cooldownMinutes ?? DEFAULT_COOLDOWN_MINUTES,
      lateCheckInHour: input.lateCheckInHour ?? DEFAULT_LATE_HOUR,
    },
  });

  return { success: true, message: "Attendance settings updated" };
}
