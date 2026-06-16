import { MembershipBillingPeriod, MembershipStatus, UserRole } from "@prisma/client";
import { addDays, addMonths, addYears } from "date-fns";
import { cacheKeys, redisCache } from "@/server/cache";
import { prisma } from "@/server/db";
import { sendReminderSmsViaMsg91 } from "@/server/auth/msg91";
import { emitNotification, NOTIFICATION_TYPES } from "@/server/services/notification.service";
import type { PublicGymInfo, PublicPlan } from "@/types/gym.types";

/**
 * Best-effort welcome SMS sent to a member right after they join. Never throws:
 * a delivery failure must not roll back the activated membership.
 */
export async function sendWelcomeSms(
  phone: string,
  memberName: string,
  gymName: string,
  planName: string,
): Promise<void> {
  try {
    await sendReminderSmsViaMsg91(
      phone,
      `Welcome to ${gymName}, ${memberName}! Your ${planName} membership is active. Show your QR pass at the gym to check in. 💪`,
    );
  } catch (error) {
    console.error("[join] Welcome SMS failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Gym statuses that may still accept new members. */
const OPEN_GYM_STATUSES = new Set(["TRIAL", "ACTIVE", "LIVE"]);

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

function deriveBenefits(billingPeriod: MembershipBillingPeriod): string[] {
  switch (billingPeriod) {
    case MembershipBillingPeriod.ANNUAL:
      return [
        "Full gym & equipment access",
        "Unlimited check-ins",
        "2 months free vs monthly",
        "Priority class booking",
      ];
    case MembershipBillingPeriod.MONTHLY:
      return ["Full gym & equipment access", "Unlimited check-ins", "Cancel anytime"];
    case MembershipBillingPeriod.TRIAL:
      return ["Full access for 30 days", "No credit card required", "Cancel anytime"];
    default:
      return ["Full gym & equipment access"];
  }
}

function toPublicPlan(plan: {
  id: string;
  name: string;
  displayPrice: string;
  pricePaise: number;
  billingPeriod: MembershipBillingPeriod;
}): PublicPlan {
  return {
    id: plan.id,
    name: plan.name,
    displayPrice: plan.displayPrice,
    pricePaise: plan.pricePaise,
    billingPeriod: plan.billingPeriod,
    isFree: plan.pricePaise <= 0,
    benefits: deriveBenefits(plan.billingPeriod),
  };
}

/**
 * Returns public-safe gym branding + plans for the Join Gym onboarding page.
 * Returns null when the gym id is malformed, the gym was deleted, or the gym
 * is not currently accepting members — the route maps this to an "invalid /
 * expired QR" recovery screen.
 */
export async function getPublicGymInfo(gymId: string): Promise<PublicGymInfo | null> {
  if (!UUID_REGEX.test(gymId)) {
    return null;
  }

  const gym = await prisma.gym.findUnique({
    where: { id: gymId },
    select: {
      id: true,
      name: true,
      city: true,
      location: true,
      status: true,
      gymSettings: {
        select: { logoUrl: true },
      },
      membershipPlans: {
        where: { status: MembershipStatus.ACTIVE },
        orderBy: { pricePaise: "asc" },
        select: {
          id: true,
          name: true,
          displayPrice: true,
          pricePaise: true,
          billingPeriod: true,
        },
      },
    },
  });

  if (!gym) {
    return null;
  }

  return {
    id: gym.id,
    name: gym.name,
    city: gym.city,
    location: gym.location,
    logoUrl: gym.gymSettings?.logoUrl ?? null,
    isAcceptingMembers: OPEN_GYM_STATUSES.has(gym.status.toUpperCase()),
    plans: gym.membershipPlans.map(toPublicPlan),
  };
}

export interface EnrollResult {
  success: boolean;
  message: string;
  redirectTo?: string;
}

/**
 * Enrolls an authenticated member into a free / trial plan instantly (no
 * payment). Paid plans go through the Razorpay create-order / verify flow.
 *
 * Idempotent and duplicate-safe: a member already enrolled at the gym has
 * their existing membership upgraded rather than duplicated.
 */
export async function enrollFreePlan(
  gymId: string,
  memberUserId: string,
  planId: string,
): Promise<EnrollResult> {
  const result = await prisma.$transaction(async (tx) => {
    const plan = await tx.membershipPlan.findFirst({
      where: { id: planId, gymId, status: MembershipStatus.ACTIVE },
      select: { id: true, name: true, billingPeriod: true, pricePaise: true },
    });

    if (!plan) {
      return { success: false as const, message: "This plan is no longer available." };
    }

    if (plan.pricePaise > 0) {
      // Guard: paid plans must not be activated without a verified payment.
      return {
        success: false as const,
        message: "This is a paid plan. Please complete payment to continue.",
      };
    }

    const member = await tx.user.findFirst({
      where: { id: memberUserId, role: UserRole.MEMBER },
      select: { id: true, fullName: true, phone: true },
    });

    if (!member) {
      return { success: false as const, message: "Member account not found." };
    }

    const expiryDate = getMembershipEndDate(new Date(), plan.billingPeriod);

    const existing = await tx.membership.findFirst({
      where: { gymId, memberUserId },
      select: { id: true },
    });

    if (existing) {
      await tx.membership.update({
        where: { id: existing.id },
        data: {
          planId: plan.id,
          planName: plan.name,
          status: MembershipStatus.ACTIVE,
          dueDate: expiryDate,
          expiryDate,
        },
        select: { id: true },
      });

      return {
        success: true as const,
        message: "Your membership is active!",
        isNew: false,
        memberName: member.fullName,
        memberPhone: member.phone,
        planName: plan.name,
      };
    }

    await tx.membership.create({
      data: {
        gymId,
        memberUserId,
        planId: plan.id,
        planName: plan.name,
        status: MembershipStatus.ACTIVE,
        dueDate: expiryDate,
        expiryDate,
      },
      select: { id: true },
    });

    return {
      success: true as const,
      message: "Welcome aboard! Your membership is active.",
      isNew: true,
      memberName: member.fullName,
      memberPhone: member.phone,
      planName: plan.name,
    };
  });

  if (!result.success) {
    return result;
  }

  await redisCache.del(cacheKeys.dashboard(gymId));

  if (result.isNew) {
    const gym = await prisma.gym.findUnique({
      where: { id: gymId },
      select: { name: true },
    });

    await emitNotification({
      gymId,
      text: `${result.memberName} joined on the ${result.planName} plan`,
      type: NOTIFICATION_TYPES.MEMBER,
      color: "text-emerald-400",
    });

    await sendWelcomeSms(
      result.memberPhone,
      result.memberName,
      gym?.name ?? "your gym",
      result.planName,
    );
  }

  return { success: true, message: result.message, redirectTo: "/member-dashboard" };
}
