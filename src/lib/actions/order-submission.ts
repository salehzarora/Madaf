/**
 * Shared order-submission idempotency helpers (PILOT-OPS-AUDIT-008-FIX1).
 *
 * Plain (non-"use server") module so it can be imported by the three
 * order-creation Server Actions — a "use server" file may only export async
 * actions, so these synchronous guards must live here.
 */

/** A v4-shaped UUID submission key. The DATABASE is the authoritative idempotency
 * gate; this only rejects obviously-malformed keys before the round-trip. */
export function isSubmissionKey(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  );
}

/** The DB idempotency conflict (MDF40): the submission key was reused with a
 * materially different order. The UI keeps the cart and offers a fresh attempt. */
export function isSubmissionConflict(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("submission key reused")
  );
}
