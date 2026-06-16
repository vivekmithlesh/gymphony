import { MembershipStatus, PaymentStatus } from "@prisma/client";
import {
  addDays,
  endOfMonth,
  format,
  startOfDay,
  startOfMonth,
  subDays,
  subMonths,
} from "date-fns";
import { CACHE_TTL_SECONDS } from "@/constants";
import { redisCache } from "@/server/cache";
import { prisma } from "@/server/db";
import { getRevenueSummary } from "@/server/services/revenue.service";
import type { InsightTrendPoint, OwnerInsights } from "@/types/gym.types";

const ATTENDANCE_TREND_DAYS = 14;
const MEMBERSHIP_GROWTH_MONTHS = 6;

function insightsCacheKey(gymId: string): string {
  return `insights:${gymId}`;
}

function formatCurrencyFromPaise(amountPaise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amountPaise / 100);
}

function percentChange(current: number, previous: number): { value: string; trend: "up" | "down" } {
  if (previous === 0) {
    return { value: current === 0 ? "0%" : "+100%", trend: "up" };
  }
  const percent = ((current - previous) / previous) * 100;
  return {
    value: `${percent >= 0 ? "+" : ""}${percent.toFixed(1)}%`,
    trend: percent >= 0 ? "up" : "down",
  };
}

/**
 * Returns business-intelligence widgets for the owner dashboard: 8 KPI cards
 * plus attendance / membership-growth / revenue trends and plan distribution.
 * Cached briefly in Redis to keep the dashboard snappy.
 */
export async function getOwnerInsights(gymId: string): Promise<OwnerInsights> {
  const cached = await redisCache.get<OwnerInsights>(insightsCacheKey(gymId));
  if (cached) {
    return cached;
  }

  const now = new Date();
  const todayStart = startOfDay(now);
  const monthStart = startOfMonth(now);
  const lastMonthEnd = endOfMonth(subMonths(now, 1));
  const attendanceWindowStart = subDays(todayStart, ATTENDANCE_TREND_DAYS - 1);
  const growthWindowStart = startOfMonth(subMonths(now, MEMBERSHIP_GROWTH_MONTHS - 1));

  const activeMemberWhere = {
    gymId,
    status: MembershipStatus.ACTIVE,
    memberUser: { isActive: true },
  } as const;

  const [
    todayCheckIns,
    activeMembers,
    previousActiveMembers,
    newMembersThisMonth,
    renewalsDue,
    expiringMemberships,
    pendingPayments,
    revenueThisMonthAgg,
    attendanceRows,
    membershipBaseCount,
    membershipRows,
    revenueSummary,
  ] = await Promise.all([
    prisma.attendanceSession.count({ where: { gymId, checkInAt: { gte: todayStart } } }),
    prisma.membership.count({ where: activeMemberWhere }),
    prisma.membership.count({
      where: { ...activeMemberWhere, createdAt: { lte: lastMonthEnd } },
    }),
    prisma.membership.count({ where: { gymId, createdAt: { gte: monthStart } } }),
    prisma.membership.count({
      where: {
        ...activeMemberWhere,
        expiryDate: { gte: todayStart, lte: addDays(todayStart, 7) },
      },
    }),
    prisma.membership.count({
      where: {
        ...activeMemberWhere,
        expiryDate: { gte: todayStart, lte: addDays(todayStart, 30) },
      },
    }),
    prisma.paymentRecord.count({ where: { gymId, status: PaymentStatus.PENDING } }),
    prisma.paymentRecord.aggregate({
      _sum: { amountPaise: true },
      where: {
        gymId,
        status: PaymentStatus.PAID,
        OR: [{ paidAt: { gte: monthStart } }, { paidAt: null, createdAt: { gte: monthStart } }],
      },
    }),
    prisma.attendanceSession.findMany({
      where: { gymId, checkInAt: { gte: attendanceWindowStart } },
      select: { checkInAt: true },
    }),
    prisma.membership.count({ where: { gymId, createdAt: { lt: growthWindowStart } } }),
    prisma.membership.findMany({
      where: { gymId, createdAt: { gte: growthWindowStart } },
      select: { createdAt: true },
    }),
    getRevenueSummary(gymId),
  ]);

  // Attendance trend: one bucket per day across the window.
  const attendanceCounts = new Map<string, number>();
  for (const row of attendanceRows) {
    const key = format(row.checkInAt, "yyyy-MM-dd");
    attendanceCounts.set(key, (attendanceCounts.get(key) ?? 0) + 1);
  }
  const attendanceTrend: InsightTrendPoint[] = Array.from(
    { length: ATTENDANCE_TREND_DAYS },
    (_, index) => {
      const day = addDays(attendanceWindowStart, index);
      return {
        label: format(day, "d MMM"),
        value: attendanceCounts.get(format(day, "yyyy-MM-dd")) ?? 0,
      };
    },
  );

  // Membership growth: cumulative member count per month.
  const monthlyNew = new Map<string, number>();
  for (const row of membershipRows) {
    const key = format(row.createdAt, "yyyy-MM");
    monthlyNew.set(key, (monthlyNew.get(key) ?? 0) + 1);
  }
  let runningTotal = membershipBaseCount;
  const membershipGrowth: InsightTrendPoint[] = Array.from(
    { length: MEMBERSHIP_GROWTH_MONTHS },
    (_, index) => {
      const monthDate = subMonths(now, MEMBERSHIP_GROWTH_MONTHS - 1 - index);
      runningTotal += monthlyNew.get(format(monthDate, "yyyy-MM")) ?? 0;
      return { label: format(monthDate, "MMM"), value: runningTotal };
    },
  );

  const growth = percentChange(activeMembers, previousActiveMembers);

  const insights: OwnerInsights = {
    cards: {
      todayCheckIns,
      activeMembers,
      revenueThisMonth: formatCurrencyFromPaise(revenueThisMonthAgg._sum.amountPaise ?? 0),
      newMembersThisMonth,
      renewalsDue,
      expiringMemberships,
      pendingPayments,
      memberGrowthPercent: growth.value,
      memberGrowthTrend: growth.trend,
    },
    attendanceTrend,
    membershipGrowth,
    revenueTrend: revenueSummary.monthly.map((point) => ({
      label: point.month,
      value: Math.round(point.amount / 100),
    })),
    planDistribution: revenueSummary.planDistribution,
  };

  await redisCache.set(insightsCacheKey(gymId), insights, CACHE_TTL_SECONDS.DASHBOARD);

  return insights;
}
