-- Add MEMBER_SIGNUP to the OtpPurpose enum so members can self-register via the Join Gym QR flow.
-- Kept in its own migration: a newly added enum value cannot be referenced in the same transaction.
ALTER TYPE "public"."OtpPurpose" ADD VALUE IF NOT EXISTS 'MEMBER_SIGNUP';
