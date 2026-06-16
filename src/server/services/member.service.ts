import { MembershipBillingPeriod, MembershipStatus, UserRole } from "@prisma/client";
import { addDays, addMonths, addYears, format, parseISO } from "date-fns";
import { cacheKeys, redisCache } from "@/server/cache";
import { prisma } from "@/server/db";
import { emitNotification, NOTIFICATION_TYPES } from "@/server/services/notification.service";
import type {
  CreateMemberInput,
  MemberListResponse,
  MemberRow,
  UpdateMemberInput,
} from "@/types/gym.types";

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function formatMemberDate(date: Date): string {
  return format(date, "d MMM, yyyy");
}

function formatMemberPhone(phone: string): string {
  const normalizedPhone = normalizePhone(phone);
  return `+91 ${normalizedPhone.slice(0, 5)} ${normalizedPhone.slice(5)}`;
}

function mapMemberStatus(status: MembershipStatus): "Active" | "Overdue" {
  return status === MembershipStatus.OVERDUE ? "Overdue" : "Active";
}

function toMemberRow(member: {
  id: string;
  planName: string;
  dueDate: Date;
  status: MembershipStatus;
  memberUser: {
    fullName: string;
    phone: string;
  };
}): MemberRow {
  return {
    id: member.id,
    name: member.memberUser.fullName,
    phone: formatMemberPhone(member.memberUser.phone),
    plan: member.planName,
    dueDate: formatMemberDate(member.dueDate),
    status: mapMemberStatus(member.status),
  };
}

function getMembershipEndDate(startDate: Date, billingPeriod: MembershipBillingPeriod): Date {
  switch (billingPeriod) {
    case MembershipBillingPeriod.MONTHLY:
      return addMonths(startDate, 1);
    case MembershipBillingPeriod.ANNUAL:
      return addYears(startDate, 1);
    case MembershipBillingPeriod.TRIAL:
      return addDays(startDate, 30);
    default:
      return startDate;
  }
}

async function invalidateMemberCaches(gymId: string, memberId?: string): Promise<void> {
  const keys = [cacheKeys.dashboard(gymId)];

  if (memberId) {
    keys.push(cacheKeys.member(memberId));
  }

  await redisCache.del(...keys);
}

/**
 * Returns paginated member list for a gym
 */
export async function getMembers(
  gymId: string,
  page: number,
  pageSize: number,
): Promise<MemberListResponse> {
  const safePage = Math.max(page, 1);
  const safePageSize = Math.max(pageSize, 1);
  const skip = (safePage - 1) * safePageSize;

  const [members, total] = await Promise.all([
    prisma.membership.findMany({
      where: {
        gymId,
        memberUser: {
          isActive: true,
        },
      },
      orderBy: {
        createdAt: "desc",
      },
      skip,
      take: safePageSize,
      select: {
        id: true,
        planName: true,
        dueDate: true,
        status: true,
        memberUser: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
    }),
    prisma.membership.count({
      where: {
        gymId,
        memberUser: {
          isActive: true,
        },
      },
    }),
  ]);

  return {
    members: members.map(toMemberRow),
    total,
    page: safePage,
    pageSize: safePageSize,
  };
}

/**
 * Creates new member with membership
 */
export async function createMember(gymId: string, input: CreateMemberInput): Promise<MemberRow> {
  const normalizedPhone = normalizePhone(input.phone);
  const membership = await prisma.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.findFirst({
      where: {
        id: input.planId,
        gymId,
      },
      select: {
        id: true,
        name: true,
        billingPeriod: true,
      },
    });

    if (!plan) {
      throw new Error("Membership plan not found");
    }

    const existingUser = await tx.user.findFirst({
      where: {
        phone: normalizedPhone,
      },
      select: {
        id: true,
        role: true,
      },
    });

    if (existingUser && existingUser.role !== UserRole.MEMBER) {
      throw new Error("This phone number is already linked to another account");
    }

    const memberUser =
      existingUser ??
      (await tx.user.create({
        data: {
          role: UserRole.MEMBER,
          fullName: input.name,
          phone: normalizedPhone,
          isActive: true,
        },
        select: {
          id: true,
          role: true,
        },
      }));

    const existingMembership = await tx.membership.findFirst({
      where: {
        gymId,
        memberUserId: memberUser.id,
      },
      select: {
        id: true,
      },
    });

    if (existingMembership) {
      throw new Error("Member already exists in this gym");
    }

    const startDate = parseISO(input.startDate);
    const expiryDate = getMembershipEndDate(startDate, plan.billingPeriod);

    return tx.membership.create({
      data: {
        gymId,
        memberUserId: memberUser.id,
        planId: plan.id,
        planName: plan.name,
        dueDate: expiryDate,
        expiryDate,
        status: MembershipStatus.ACTIVE,
      },
      select: {
        id: true,
        planName: true,
        dueDate: true,
        status: true,
        memberUser: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
    });
  });

  await invalidateMemberCaches(gymId, membership.id);

  await emitNotification({
    gymId,
    text: `${membership.memberUser.fullName} was added on the ${membership.planName} plan`,
    type: NOTIFICATION_TYPES.MEMBER,
    color: "text-emerald-400",
  });

  return toMemberRow(membership);
}

/**
 * Updates member details
 */
export async function updateMember(
  memberId: string,
  gymId: string,
  input: UpdateMemberInput,
): Promise<MemberRow> {
  const membership = await prisma.$transaction(async (tx) => {
    const existingMembership = await tx.membership.findFirst({
      where: {
        id: memberId,
        gymId,
      },
      select: {
        id: true,
        memberUserId: true,
      },
    });

    if (!existingMembership) {
      throw new Error("Member not found");
    }

    if (input.planId) {
      const nextPlan = await tx.membershipPlan.findFirst({
        where: {
          id: input.planId,
          gymId,
        },
        select: {
          id: true,
          name: true,
        },
      });

      if (!nextPlan) {
        throw new Error("Membership plan not found");
      }

      await tx.membership.update({
        where: {
          id: memberId,
        },
        data: {
          planId: nextPlan.id,
          planName: nextPlan.name,
        },
        select: {
          id: true,
        },
      });
    }

    if (input.name !== undefined || input.phone !== undefined) {
      await tx.user.update({
        where: {
          id: existingMembership.memberUserId,
        },
        data: {
          ...(input.name !== undefined ? { fullName: input.name } : {}),
          ...(input.phone !== undefined ? { phone: normalizePhone(input.phone) } : {}),
        },
        select: {
          id: true,
        },
      });
    }

    return tx.membership.update({
      where: {
        id: memberId,
      },
      data: {
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      select: {
        id: true,
        planName: true,
        dueDate: true,
        status: true,
        memberUser: {
          select: {
            fullName: true,
            phone: true,
          },
        },
      },
    });
  });

  await invalidateMemberCaches(gymId, memberId);

  return toMemberRow(membership);
}

/**
 * Soft deletes member (sets isActive=false)
 */
export async function deleteMember(memberId: string, gymId: string): Promise<void> {
  const membership = await prisma.membership.findFirst({
    where: {
      id: memberId,
      gymId,
    },
    select: {
      id: true,
      memberUserId: true,
    },
  });

  if (!membership) {
    throw new Error("Member not found");
  }

  await prisma.user.update({
    where: {
      id: membership.memberUserId,
    },
    data: {
      isActive: false,
    },
    select: {
      id: true,
    },
  });

  await invalidateMemberCaches(gymId, memberId);
}
