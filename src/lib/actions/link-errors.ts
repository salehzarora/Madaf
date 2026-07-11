/**
 * Shared failure-category helpers for the tokenized-link Server Actions
 * (M8E.2 review #7). Actions must return DISTINCT, safe categories and never
 * leak a raw token, configured URL, Vercel metadata, or DB internals in the
 * payload — the category alone drives a localized message.
 *
 * Categories:
 *  - "config"      — the canonical public app URL is missing/invalid/conflict
 *                    (from createCanonicalLink; nothing was persisted).
 *  - "validation"  — an input/part was invalid when building the URL.
 *  - "persistence" — the DB mutation (or transport) failed; the transaction
 *                    rolled back, so any previous link survives.
 *  - "inactive"    — (customer links only) the store is deactivated (MDF33).
 */

/** Generic link-action failure category (excludes the customer-only "inactive"). */
export type LinkFailureReason = "config" | "validation" | "persistence";

/**
 * True when a thrown persist error is the "deactivated store" gate (MDF33) from
 * `replace_customer_access_link`. Matched on the DB error text only — no token
 * or URL is ever inspected or surfaced.
 */
export function isInactiveStoreError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes("mdf33") ||
    message.includes("deactivat") ||
    message.includes("inactive")
  );
}
