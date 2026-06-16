import { OTP_PURPOSES } from "@/constants";
import type { UserRole as AppUserRole } from "@/constants/roles";

export type OtpPurpose = (typeof OTP_PURPOSES)[keyof typeof OTP_PURPOSES];
export type UserRole = AppUserRole;

export interface OtpPayload {
  phone: string;
  purpose: OtpPurpose;
  metadata?: Record<string, unknown>;
}

export interface OwnerSignupMetadata {
  ownerName: string;
  gymName: string;
  city: string;
  email: string;
  phone: string;
}

export interface MemberSignupMetadata {
  fullName: string;
  phone: string;
  gymId: string;
}

export interface SessionPayload {
  userId: string;
  gymId: string;
  role: UserRole;
  iat: number;
  exp: number;
}

export interface AuthResult {
  success: boolean;
  message: string;
  sessionToken?: string;
  redirectTo?: string;
  /** True when the member already had a membership at the target gym. */
  alreadyMember?: boolean;
}

export interface OtpSendResult {
  success: boolean;
  message: string;
  rateLimitRemaining?: number;
}
