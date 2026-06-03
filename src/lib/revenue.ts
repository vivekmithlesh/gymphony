// Revenue aggregation helpers — the single source of truth for "what counts as
// realized revenue", shared by the Owner Dashboard and the Revenue Analytics page
// so their headline numbers can never drift apart.
//
// The `payments` table carries several status spellings written by different
// flows:
//   • 'Paid'                  — owner records a cash/manual payment (MembersList)
//   • 'Success'               — member UPI payment approved by the owner
//                               (approve_payment RPC)
//   • 'pending_verification'  — member tapped "I have paid", awaiting approval
//   • 'rejected'              — owner rejected the pending payment
//
// Only APPROVED money (Paid / Success) is realized revenue. Pending and rejected
// payments must never inflate revenue cards, charts, or metrics.

/** Payment statuses that represent realized (collected/approved) revenue. */
const APPROVED_PAYMENT_STATUSES = new Set(["paid", "success"]);

/**
 * Whether a payment row counts as realized revenue. Case-insensitive and
 * tolerant of null/blank status. Anything not explicitly approved
 * (pending_verification, rejected, unknown) is excluded.
 */
export function isApprovedPayment(status?: string | null): boolean {
  return APPROVED_PAYMENT_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/** Sum the `amount` of only the approved payments in a list. */
export function sumApprovedPayments(
  payments: Array<{ amount?: number | string | null; status?: string | null }>
): number {
  return payments.reduce(
    (total, p) => (isApprovedPayment(p.status) ? total + (Number(p.amount) || 0) : total),
    0
  );
}
