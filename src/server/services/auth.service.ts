import {
  MembershipBillingPeriod,
  MembershipStatus,
  UserRole as PrismaUserRole,
} from "@prisma/client";
import { deleteCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { OTP_PURPOSES, OTP_RATE_LIMITS } from "@/constants";
import { cacheKeys, redisCache } from "@/server/cache";
import { prisma } from "@/server/db";
import { createOtp, deleteOtp, verifyAndConsumeOtp } from "@/server/auth/otp";
import { sendOtpViaMsg91 } from "@/server/auth/msg91";
import { createSessionToken } from "@/server/auth/session";
import { getPublicGymInfo } from "@/server/services/join.service";
import type {
  AuthResult,
  MemberSignupMetadata,
  OtpSendResult,
  OwnerSignupMetadata,
} from "@/types/auth.types";

const ownerSignupMetadataSchema = z.object({
  ownerName: z.string().min(2),
  gymName: z.string().min(2),
  city: z.string().min(2),
  email: z.string().email(),
  phone: z.string().regex(/^[6-9]\d{9}$/),
});

const memberSignupMetadataSchema = z.object({
  fullName: z.string().min(2),
  phone: z.string().regex(/^[6-9]\d{9}$/),
  gymId: z.string().uuid(),
});

function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

async function consumeRateLimit(phone: string): Promise<{
  allowed: boolean;
  remaining: number;
}> {
  const normalizedPhone = normalizePhone(phone);
  const key = cacheKeys.otpRateLimit(normalizedPhone);
  const count = await redisCache.incr(key, OTP_RATE_LIMITS.WINDOW_SECONDS);
  const remaining = Math.max(OTP_RATE_LIMITS.MAX_REQUESTS_PER_HOUR - count, 0);

  return {
    allowed: count <= OTP_RATE_LIMITS.MAX_REQUESTS_PER_HOUR,
    remaining,
  };
}

async function createAndSendOtp(
  phone: string,
  purpose: (typeof OTP_PURPOSES)[keyof typeof OTP_PURPOSES],
  metadata?: Record<string, unknown>,
): Promise<OtpSendResult> {
  const { allowed, remaining } = await consumeRateLimit(phone);

  if (!allowed) {
    return {
      success: false,
      message: "Too many OTP requests. Please try again in an hour.",
      rateLimitRemaining: 0,
    };
  }

  const { code, record } = await createOtp({
    phone: normalizePhone(phone),
    purpose,
    metadata,
  });

  const sendResult = await sendOtpViaMsg91(record.phone, code);

  if (!sendResult.success) {
    await deleteOtp(record.id);
    return {
      ...sendResult,
      rateLimitRemaining: remaining,
    };
  }

  return {
    success: true,
    message: sendResult.message,
    rateLimitRemaining: remaining,
  };
}

async function getMemberSessionTarget(phone: string) {
  return prisma.membership.findFirst({
    where: {
      memberUser: {
        phone: normalizePhone(phone),
        role: PrismaUserRole.MEMBER,
      },
    },
    include: {
      memberUser: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });
}

/**
 * Sends OTP for owner signup. Enforces rate limit.
 */
export async function sendOwnerSignupOtp(data: OwnerSignupMetadata): Promise<OtpSendResult> {
  const normalizedData = ownerSignupMetadataSchema.parse({
    ...data,
    phone: normalizePhone(data.phone),
  });

  const existingOwner = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalizedData.phone }, { email: normalizedData.email }],
    },
    select: {
      id: true,
    },
  });

  if (existingOwner) {
    return {
      success: false,
      message: "An account already exists with this phone or email",
    };
  }

  return createAndSendOtp(normalizedData.phone, OTP_PURPOSES.OWNER_SIGNUP, normalizedData);
}

/**
 * Verifies owner OTP, creates user+gym+settings, returns session token.
 */
export async function verifyOwnerSignupOtp(phone: string, code: string): Promise<AuthResult> {
  const normalizedPhone = normalizePhone(phone);
  const otpRecord = await verifyAndConsumeOtp(normalizedPhone, OTP_PURPOSES.OWNER_SIGNUP, code);

  if (!otpRecord) {
    return {
      success: false,
      message: "Invalid or expired OTP",
    };
  }

  const metadata = ownerSignupMetadataSchema.safeParse(otpRecord.metadata);

  if (!metadata.success) {
    return {
      success: false,
      message: "Signup data is incomplete. Please restart signup.",
    };
  }

  const existingOwner = await prisma.user.findFirst({
    where: {
      OR: [{ phone: normalizedPhone }, { email: metadata.data.email }],
    },
    select: {
      id: true,
    },
  });

  if (existingOwner) {
    return {
      success: false,
      message: "An account already exists with this phone or email",
    };
  }

  const { user, gym } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role: PrismaUserRole.OWNER,
        fullName: metadata.data.ownerName,
        phone: normalizedPhone,
        email: metadata.data.email,
      },
    });

    const gym = await tx.gym.create({
      data: {
        ownerUserId: user.id,
        name: metadata.data.gymName,
        city: metadata.data.city,
        status: "TRIAL",
      },
    });

    await tx.gymSetting.create({
      data: {
        gymId: gym.id,
        ownerEmail: metadata.data.email,
        contactNumber: normalizedPhone,
      },
    });

    await tx.membershipPlan.create({
      data: {
        gymId: gym.id,
        name: "Trial Plan",
        billingPeriod: MembershipBillingPeriod.TRIAL,
        pricePaise: 0,
        displayPrice: "Free",
        status: MembershipStatus.ACTIVE,
      },
    });

    return { user, gym };
  });

  const sessionToken = await createSessionToken({
    userId: user.id,
    gymId: gym.id,
    role: PrismaUserRole.OWNER,
  });

  return {
    success: true,
    message: "Signup completed successfully",
    sessionToken,
    redirectTo: "/dashboard",
  };
}

/**
 * Sends OTP for member login. Enforces rate limit.
 */
export async function sendMemberLoginOtp(phone: string): Promise<OtpSendResult> {
  const normalizedPhone = normalizePhone(phone);
  const memberTarget = await getMemberSessionTarget(normalizedPhone);

  if (!memberTarget) {
    return {
      success: false,
      message: "No member account found for this number",
    };
  }

  return createAndSendOtp(normalizedPhone, OTP_PURPOSES.MEMBER_LOGIN);
}

/**
 * Verifies member OTP, returns session token.
 */
export async function verifyMemberLoginOtp(phone: string, code: string): Promise<AuthResult> {
  const normalizedPhone = normalizePhone(phone);
  const memberTarget = await getMemberSessionTarget(normalizedPhone);

  if (!memberTarget) {
    return {
      success: false,
      message: "No member account found for this number",
    };
  }

  const otpRecord = await verifyAndConsumeOtp(normalizedPhone, OTP_PURPOSES.MEMBER_LOGIN, code);

  if (!otpRecord) {
    return {
      success: false,
      message: "Invalid or expired OTP",
    };
  }

  const sessionToken = await createSessionToken({
    userId: memberTarget.memberUser.id,
    gymId: memberTarget.gymId,
    role: memberTarget.memberUser.role,
  });

  return {
    success: true,
    message: "Login successful",
    sessionToken,
    redirectTo: "/member-dashboard",
  };
}

/**
 * Sends OTP for member self-signup via the Join Gym QR flow.
 * Validates that the target gym exists and is accepting members, and that the
 * phone is not already tied to a non-member (owner/staff) account.
 */
export async function sendMemberSignupOtp(data: MemberSignupMetadata): Promise<OtpSendResult> {
  const parsed = memberSignupMetadataSchema.safeParse({
    ...data,
    phone: normalizePhone(data.phone),
    fullName: data.fullName.trim(),
  });

  if (!parsed.success) {
    return { success: false, message: "Please enter a valid name and mobile number." };
  }

  const gym = await getPublicGymInfo(parsed.data.gymId);

  if (!gym || !gym.isAcceptingMembers) {
    return {
      success: false,
      message: "This gym link is invalid or no longer accepting members.",
    };
  }

  const existingUser = await prisma.user.findFirst({
    where: { phone: parsed.data.phone },
    select: { role: true },
  });

  if (existingUser && existingUser.role !== PrismaUserRole.MEMBER) {
    return {
      success: false,
      message: "This phone number is already linked to a gym owner or staff account.",
    };
  }

  return createAndSendOtp(parsed.data.phone, OTP_PURPOSES.MEMBER_SIGNUP, parsed.data);
}

/**
 * Verifies the member-signup OTP, creates (or reuses) the member account, and
 * issues a session scoped to the gym they are joining. The member can then
 * complete enrollment (free activation or paid checkout).
 */
export async function verifyMemberSignupOtp(phone: string, code: string): Promise<AuthResult> {
  const normalizedPhone = normalizePhone(phone);
  const otpRecord = await verifyAndConsumeOtp(normalizedPhone, OTP_PURPOSES.MEMBER_SIGNUP, code);

  if (!otpRecord) {
    return { success: false, message: "Invalid or expired OTP" };
  }

  const metadata = memberSignupMetadataSchema.safeParse(otpRecord.metadata);

  if (!metadata.success) {
    return {
      success: false,
      message: "Signup data is incomplete. Please scan the gym QR again.",
    };
  }

  const gym = await getPublicGymInfo(metadata.data.gymId);

  if (!gym || !gym.isAcceptingMembers) {
    return {
      success: false,
      message: "This gym is no longer accepting members.",
    };
  }

  const existingUser = await prisma.user.findFirst({
    where: { phone: normalizedPhone },
    select: { id: true, role: true, fullName: true, isActive: true },
  });

  if (existingUser && existingUser.role !== PrismaUserRole.MEMBER) {
    return {
      success: false,
      message: "This phone number is already linked to another account.",
    };
  }

  const memberUser =
    existingUser ??
    (await prisma.user.create({
      data: {
        role: PrismaUserRole.MEMBER,
        fullName: metadata.data.fullName,
        phone: normalizedPhone,
        isActive: true,
      },
      select: { id: true, role: true, fullName: true, isActive: true },
    }));

  // Reactivate a previously soft-deleted member who rejoins.
  if (existingUser && !existingUser.isActive) {
    await prisma.user.update({
      where: { id: memberUser.id },
      data: { isActive: true },
      select: { id: true },
    });
  }

  const existingMembership = await prisma.membership.findFirst({
    where: { gymId: metadata.data.gymId, memberUserId: memberUser.id },
    select: { id: true },
  });

  const sessionToken = await createSessionToken({
    userId: memberUser.id,
    gymId: metadata.data.gymId,
    role: PrismaUserRole.MEMBER,
  });

  return {
    success: true,
    message: existingMembership ? "Welcome back!" : "Account verified",
    sessionToken,
    alreadyMember: Boolean(existingMembership),
    redirectTo: existingMembership ? "/member-dashboard" : undefined,
  };
}

/**
 * Destroys session (clears cookie).
 */
export async function logout(): Promise<void> {
  deleteCookie("gym_session", {
    path: "/",
    sameSite: "strict",
    httpOnly: true,
    maxAge: 0,
  });
}
