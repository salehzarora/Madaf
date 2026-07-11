import type { Dictionary } from "@/i18n/types";

/**
 * Map a tokenized-link action's failure CATEGORY to a localized, SAFE message
 * (M8E.2 review #7). The category alone selects the text — a raw token,
 * configured URL, Vercel metadata, or DB detail is NEVER surfaced. A rejected
 * Server Action (transport/network) has no category and falls through to the
 * generic operation error, so it is never mislabeled as a config failure.
 *
 *  - "config"      → the public app URL is unconfigured/invalid/conflicting.
 *  - "validation"  → a safe generic link-generation error.
 *  - "persistence" / undefined (incl. a rejected action) → generic op error.
 */
export function linkErrorMessage(
  common: Dictionary["common"],
  reason: string | undefined,
): string {
  switch (reason) {
    case "config":
      return common.linkUrlError;
    case "validation":
      return common.linkGenerationError;
    case "persistence":
      return common.actionError;
    default:
      return common.actionError;
  }
}
