// =============================================================================
// member-signup — the single, isolated "create a member" flow.
// -----------------------------------------------------------------------------
// Counterpart to owner-signup.ts. Members are created here ONLY (role=member);
// they never touch the owner "Create My Gym" path. Two entry shapes:
//   • self-serve  → registerMember() then pick a gym on /member-join
//   • invite claim → registerMember() then claimInvite() to bind the pending
//     members slot the owner created in BulkOnboard.
//
// `ensureMemberProfile` is shared with /member-login so a returning member who
// lacks a profile/members row still gets one (role=member).
// =============================================================================

import type { User } from "@supabase/supabase-js";
import { supabase } from "@/supabase";

export interface MemberSignupInput {
  email: string;
  password: string;
  fullName?: string;
}

export type RegisterMemberOutcome =
  | { status: "created"; hasSession: boolean; user: User }
  | { status: "exists" };

/** Create a member auth user (role=member). Never creates an owner. */
export async function registerMember(input: MemberSignupInput): Promise<RegisterMemberOutcome> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: { data: { role: "member", full_name: input.fullName } },
  });

  if (error) {
    const msg = String(error.message || "").toLowerCase();
    if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
      return { status: "exists" };
    }
    throw error;
  }

  if (!data.user) throw new Error("Failed to create auth user");
  return { status: "created", hasSession: Boolean(data.session), user: data.user };
}

/**
 * Idempotently ensure a member has a `profiles` row (role=member).
 *
 * `members` is a VIEW over `profiles`, so creating the profiles row is enough —
 * the member automatically surfaces in `members`. We do NOT insert into the view
 * (the old code wrote a `role` column the view lacks and always errored).
 *
 * New members start status='Pending'. Only the gym owner's verified-payment
 * approval (approve_payment → app_activate_member) may flip them to 'Active'; the
 * BEFORE-UPDATE lockdown trigger on profiles blocks any client self-activation,
 * so the initial INSERT is the only place status can be seeded.
 */
export async function ensureMemberProfile(user: User, phoneE164?: string): Promise<void> {
  try {
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", user.id)
      .maybeSingle();

    if (!profileRow) {
      const phone = phoneE164?.trim();
      await supabase.from("profiles").insert([
        {
          id: user.id,
          full_name: user.user_metadata?.full_name || user.email?.split("@")[0] || "Member",
          email: user.email,
          ...(phone ? { phone, mobile_number: phone } : {}),
          status: "Pending",
          role: "member",
        },
      ]);
    } else if (phoneE164?.trim()) {
      // Returning member without a stored phone — fill it (phone is not a
      // lockdown-protected column, so this update is allowed).
      await supabase
        .from("profiles")
        .update({ phone: phoneE164.trim(), mobile_number: phoneE164.trim() })
        .eq("id", user.id);
    }
  } catch (err) {
    console.error("ensureMemberProfile failed:", err);
  }
}

/** True when a Supabase error is a unique-violation (account already exists). */
function isDuplicate(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  return (
    String(error.message || "").toLowerCase().includes("duplicate") ||
    String(error.code || "").includes("23505")
  );
}

/**
 * Bind a freshly-created member (their auth uid == their member identity) to the
 * invite's gym. Identity is profiles.id = auth.uid(); there is NO auth_user_id
 * column and the legacy "pending slot" row keyed by a separate uuid can't be
 * adopted from the member's session (profiles RLS), so we create/maintain the
 * member's OWN profiles row and bind it to the gym.
 *
 * status is seeded to 'Pending' ONLY on the initial INSERT — the BEFORE-UPDATE
 * lockdown trigger forbids changing status from a member session, so an
 * already-existing row is updated for gym binding + contact details only.
 */
export async function claimInvite(params: {
  userId: string;
  inviteToken: string | null;
  inviteGymId: string | null;
  fullName: string;
  phoneE164: string;
}): Promise<{ duplicate: boolean }> {
  const { userId, inviteGymId, fullName, phoneE164 } = params;

  // Resolve the gym's owner so the member is bound on gym_owner_id too (the kiosk
  // cross-gym guard and check_ins RLS authorize on it).
  let gymOwnerId: string | null = null;
  if (inviteGymId) {
    const { data: gymRow } = await supabase
      .from("gym_settings")
      .select("gym_owner_id")
      .eq("id", inviteGymId)
      .maybeSingle();
    gymOwnerId = gymRow?.gym_owner_id ?? null;
  }

  const gymBinding: Record<string, unknown> = {};
  if (inviteGymId) {
    gymBinding.gym_id = inviteGymId;
    if (gymOwnerId) gymBinding.gym_owner_id = gymOwnerId;
  }

  // Consume any pending owner-created invite for this gym matching the phone, so
  // it drops off the owner's pending list once the member signs up (best-effort).
  const claimInviteRow = () => {
    if (inviteGymId) void supabase.rpc("app_claim_member_invite", { p_gym_id: inviteGymId });
  };

  // Fresh auth user → INSERT (status allowed). status starts 'Pending' so the
  // member goes through the owner-approval gate.
  const { error: insertError } = await supabase.from("profiles").insert([
    {
      id: userId,
      full_name: fullName,
      phone: phoneE164,
      mobile_number: phoneE164,
      status: "Pending",
      role: "member",
      ...gymBinding,
    },
  ]);

  if (!insertError) {
    claimInviteRow();
    return { duplicate: false };
  }

  // A profiles row already exists (e.g. an auth on-signup trigger created one).
  // Update only NON-protected columns — never status (lockdown trigger).
  if (isDuplicate(insertError)) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ full_name: fullName, phone: phoneE164, mobile_number: phoneE164, ...gymBinding })
      .eq("id", userId);
    if (updateError) throw updateError;
    claimInviteRow();
    return { duplicate: false };
  }

  throw insertError;
}
