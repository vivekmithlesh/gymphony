// =============================================================================
// Kiosk pass logic — the security-critical decisions for member check-in,
// extracted as PURE functions so they can be exhaustively unit-tested and so
// the Virtual ID Card (MemberQRCard) and the Kiosk Scanner (KioskMode) share a
// single source of truth for the payload contract.
//
//   Card encodes : {"member_id":"<uuid>","gym_id":"<uuid>"}
//   Kiosk decodes: same shape; also tolerates a bare member UUID (legacy cards)
//
// No member from a different gym may ever be logged at this kiosk — that rule
// is enforced twice (pre-DB on the QR's gym, post-DB on the member's home gym).
// =============================================================================

export interface ParsedPass {
  memberId: string | null;
  qrGymId: string | null;
}

/**
 * Build the QR payload the Virtual ID Card renders. Kept beside the parser so
 * the encode/decode contract can never drift — parseMemberPass is its inverse.
 */
export function buildMemberPass(member: { id: string; gym_id?: string | null }): string {
  if (!member.id) return '';
  return JSON.stringify({ member_id: member.id, gym_id: member.gym_id ?? null });
}

/**
 * Decode the raw scanned string into a member id + the gym the pass claims.
 * A wall-poster QR ({"gym_id":...}, no member_id) yields memberId=null and is
 * therefore rejected upstream as "not a member pass". A bare UUID is treated as
 * a legacy member id with no embedded gym.
 */
export function parseMemberPass(raw: string): ParsedPass {
  const text = (raw || '').trim();
  if (!text) return { memberId: null, qrGymId: null };

  if (text.startsWith('{')) {
    try {
      const obj = JSON.parse(text);
      return {
        memberId: typeof obj.member_id === 'string' ? obj.member_id.trim() || null : null,
        qrGymId: typeof obj.gym_id === 'string' ? obj.gym_id.trim() || null : null,
      };
    } catch {
      return { memberId: null, qrGymId: null };
    }
  }

  return { memberId: text, qrGymId: null };
}

export interface Rejection {
  kind: 'reject';
  overlayLabel: string;
  message: string;
}

export interface ProceedToLookup {
  kind: 'lookup';
  memberId: string;
}

export type PreLookupOutcome = Rejection | ProceedToLookup;

/**
 * Decide what to do with a scan BEFORE any database round-trip. Catches the
 * three cases we can rule on from the QR + kiosk identity alone: an unlinked
 * kiosk, a non-member QR, and a pass that openly belongs to another gym. The
 * last one matters for security AND correctness — we never attempt to read a
 * foreign gym's member row (RLS would block it and report a misleading
 * "not found").
 */
export function evaluatePassPreLookup(decodedText: string, kioskGymId: string | null): PreLookupOutcome {
  if (!kioskGymId) {
    return {
      kind: 'reject',
      overlayLabel: 'Setup incomplete',
      message: 'Kiosk is not linked to a gym yet. Finish gym setup, then reload.',
    };
  }

  const { memberId, qrGymId } = parseMemberPass(decodedText);

  if (!memberId) {
    return {
      kind: 'reject',
      overlayLabel: 'Invalid pass',
      message: 'Unrecognized QR — that is not a Gymphony member pass.',
    };
  }

  if (qrGymId && qrGymId !== kioskGymId) {
    return {
      kind: 'reject',
      overlayLabel: 'Wrong gym',
      message: 'This pass belongs to a different gym.',
    };
  }

  return { kind: 'lookup', memberId };
}

export interface MemberRow {
  id: string;
  full_name: string | null;
  status: string | null;
  gym_id: string | null;
  gym_owner_id: string | null;
}

export interface AccessAllowed {
  kind: 'allow';
  member: MemberRow;
  status: 'granted' | 'denied';
}

export type PostLookupOutcome = Rejection | AccessAllowed;

/**
 * Decide what to do AFTER the member row comes back from the DB.
 *
 * This is the PRIMARY cross-gym guard, not a mere fallback: the `members` table
 * has no gym-scoped SELECT policy, so a foreign member's row IS readable here.
 * The only thing stopping a cross-gym check-in for a bare-UUID pass (no gym in
 * the QR) is this check.
 *
 * It authorizes on `gym_owner_id` — the canonical ownership key the rest of the
 * app and the check_ins RLS policy use (`members.gym_owner_id = auth.uid()`).
 * We deliberately do NOT compare `members.gym_id` here: that column is the one
 * prone to nulls/staleness (the integrity gap), and using it would falsely
 * reject legitimate members whose gym_id was never backfilled.
 *
 * Membership status (Overdue/Expired) downgrades to a logged-but-denied entry
 * rather than a hard reject, matching kiosk attendance semantics.
 */
export function evaluateMember(
  member: MemberRow | null,
  lookupFailed: boolean,
  kioskOwnerId: string | null,
): PostLookupOutcome {
  if (lookupFailed || !member) {
    return {
      kind: 'reject',
      overlayLabel: 'Not found',
      message: 'Invalid QR code — member not found at this gym.',
    };
  }

  if (member.gym_owner_id && member.gym_owner_id !== kioskOwnerId) {
    return {
      kind: 'reject',
      overlayLabel: 'Wrong gym',
      message: 'This pass belongs to a different gym.',
    };
  }

  const status: 'granted' | 'denied' =
    member.status === 'Overdue' || member.status === 'Expired' ? 'denied' : 'granted';

  return { kind: 'allow', member, status };
}
