import { MembershipBillingPeriod, MembershipStatus, PaymentStatus } from "@prisma/client";
import { addDays, addMonths, addYears, startOfDay } from "date-fns";
import { env } from "@/config";
import { cacheKeys, redisCache } from "@/server/cache";
import { prisma } from "@/server/db";
import { createOrder, verifyPaymentSignature } from "@/server/payments/razorpay";
import { emitNotification, NOTIFICATION_TYPES } from "@/server/services/notification.service";
import { sendWelcomeSms } from "@/server/services/join.service";
import type { PaymentVerifyInput, RazorpayOrderResult } from "@/types/gym.types";

const PAYMENT_ORDER_META_TTL_SECONDS = 24 * 60 * 60;

interface PaymentOrderMeta {
  planId: string;
}

function getPaymentOrderMetaKey(orderId: string): string {
  return `payment-order:${orderId}`;
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

async function resolvePlanForPayment(gymId: string, orderId: string, amountPaise: number) {
  const orderMeta = await redisCache.get<PaymentOrderMeta>(getPaymentOrderMetaKey(orderId));

  if (orderMeta?.planId) {
    const plan = await prisma.membershipPlan.findFirst({
      where: {
        id: orderMeta.planId,
        gymId,
      },
      select: {
        id: true,
        name: true,
        billingPeriod: true,
      },
    });

    if (plan) {
      return plan;
    }
  }

  return prisma.membershipPlan.findFirst({
    where: {
      gymId,
      pricePaise: amountPaise,
      status: MembershipStatus.ACTIVE,
    },
    orderBy: {
      createdAt: "desc",
    },
    select: {
      id: true,
      name: true,
      billingPeriod: true,
    },
  });
}

/**
 * Creates Razorpay order for a membership plan
 */
export async function createPaymentOrder(
  gymId: string,
  memberUserId: string,
  planId: string,
): Promise<RazorpayOrderResult> {
  const plan = await prisma.membershipPlan.findFirst({
    where: {
      id: planId,
      gymId,
      status: MembershipStatus.ACTIVE,
    },
    select: {
      id: true,
      pricePaise: true,
      displayPrice: true,
    },
  });

  if (!plan) {
    throw new Error("Membership plan not found");
  }

  const existingMembership = await prisma.membership.findFirst({
    where: {
      gymId,
      memberUserId,
    },
    orderBy: {
      updatedAt: "desc",
    },
    select: {
      id: true,
    },
  });

  const paymentRecord = await prisma.paymentRecord.create({
    data: {
      gymId,
      memberUserId,
      membershipId: existingMembership?.id,
      amountPaise: plan.pricePaise,
      amountDisplay: plan.displayPrice,
      status: PaymentStatus.PENDING,
      provider: "RAZORPAY",
    },
    select: {
      id: true,
    },
  });

  try {
    const order = await createOrder(plan.pricePaise, paymentRecord.id);

    await Promise.all([
      prisma.paymentRecord.update({
        where: {
          id: paymentRecord.id,
        },
        data: {
          providerOrderId: order.id,
        },
      }),
      redisCache.set<PaymentOrderMeta>(
        getPaymentOrderMetaKey(order.id),
        {
          planId: plan.id,
        },
        PAYMENT_ORDER_META_TTL_SECONDS,
      ),
    ]);

    return {
      orderId: order.id,
      amount: plan.pricePaise,
      currency: "INR",
      keyId: env.RAZORPAY_KEY_ID,
    };
  } catch (error) {
    await prisma.paymentRecord.update({
      where: {
        id: paymentRecord.id,
      },
      data: {
        status: PaymentStatus.FAILED,
      },
    });

    throw error;
  }
}

/**
 * Verifies payment and activates membership
 */
export async function verifyPayment(
  input: PaymentVerifyInput,
  gymId: string,
  memberUserId: string,
): Promise<{ success: boolean; message: string }> {
  if (
    !verifyPaymentSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)
  ) {
    return {
      success: false,
      message: "Invalid Razorpay payment signature",
    };
  }

  const paymentRecord = await prisma.paymentRecord.findFirst({
    where: {
      gymId,
      memberUserId,
      providerOrderId: input.razorpayOrderId,
    },
    select: {
      id: true,
      membershipId: true,
      amountPaise: true,
      status: true,
    },
  });

  if (!paymentRecord) {
    return {
      success: false,
      message: "Payment record not found",
    };
  }

  if (paymentRecord.status === PaymentStatus.PAID) {
    return {
      success: true,
      message: "Payment already verified",
    };
  }

  const plan = await resolvePlanForPayment(gymId, input.razorpayOrderId, paymentRecord.amountPaise);

  if (!plan) {
    return {
      success: false,
      message: "Unable to resolve membership plan for this payment",
    };
  }

  const today = startOfDay(new Date());
  const expiryDate = getMembershipEndDate(today, plan.billingPeriod);

  const enrollment = await prisma.$transaction(async (tx) => {
    await tx.paymentRecord.update({
      where: {
        id: paymentRecord.id,
      },
      data: {
        status: PaymentStatus.PAID,
        providerPaymentId: input.razorpayPaymentId,
        paidAt: new Date(),
      },
    });

    const targetMembershipId = input.membershipId || paymentRecord.membershipId;

    const existingMembership = targetMembershipId
      ? await tx.membership.findFirst({
          where: {
            id: targetMembershipId,
            gymId,
            memberUserId,
          },
          select: {
            id: true,
          },
        })
      : await tx.membership.findFirst({
          where: {
            gymId,
            memberUserId,
          },
          orderBy: {
            updatedAt: "desc",
          },
          select: {
            id: true,
          },
        });

    const membership = existingMembership
      ? await tx.membership.update({
          where: {
            id: existingMembership.id,
          },
          data: {
            planId: plan.id,
            planName: plan.name,
            status: MembershipStatus.ACTIVE,
            dueDate: expiryDate,
            expiryDate,
          },
          select: {
            id: true,
          },
        })
      : await tx.membership.create({
          data: {
            gymId,
            memberUserId,
            planId: plan.id,
            planName: plan.name,
            status: MembershipStatus.ACTIVE,
            dueDate: expiryDate,
            expiryDate,
          },
          select: {
            id: true,
          },
        });

    await tx.paymentRecord.update({
      where: {
        id: paymentRecord.id,
      },
      data: {
        membershipId: membership.id,
      },
    });

    return { isNewMembership: !existingMembership };
  });

  await Promise.all([
    redisCache.del(cacheKeys.dashboard(gymId)),
    redisCache.del(getPaymentOrderMetaKey(input.razorpayOrderId)),
  ]);

  const [member, gym] = await Promise.all([
    prisma.user.findUnique({
      where: { id: memberUserId },
      select: { fullName: true, phone: true },
    }),
    prisma.gym.findUnique({
      where: { id: gymId },
      select: { name: true },
    }),
  ]);
  const memberName = member?.fullName ?? "A member";

  await emitNotification({
    gymId,
    text: `Payment received from ${memberName} for ${plan.name}`,
    type: NOTIFICATION_TYPES.PAYMENT,
    color: "text-emerald-400",
  });

  if (enrollment.isNewMembership) {
    await emitNotification({
      gymId,
      text: `${memberName} joined on the ${plan.name} plan`,
      type: NOTIFICATION_TYPES.MEMBER,
      color: "text-emerald-400",
    });

    if (member?.phone) {
      await sendWelcomeSms(member.phone, memberName, gym?.name ?? "your gym", plan.name);
    }
  } else {
    await emitNotification({
      gymId,
      text: `${memberName} renewed the ${plan.name} plan`,
      type: NOTIFICATION_TYPES.RENEWAL,
      color: "text-violet-400",
    });
  }

  return {
    success: true,
    message: "Payment verified and membership activated",
  };
}
