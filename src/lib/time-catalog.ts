/**
 * The Settings timezone CATALOG — server-only (M8H.2).
 *
 * This lives apart from `@/lib/time` for one concrete reason: `time.ts` holds the
 * FORMATTERS, and the formatters are imported by a dozen client components. Any
 * module-level work in that file therefore ships to the browser — and the catalog's
 * `Intl.supportedValuesOf("timeZone")` IIFE did exactly that: it was evaluated in
 * eight client chunks, rebuilding a 418-entry array in every visitor's browser to
 * produce a list only ONE server-rendered page ever needs, and only as a prop.
 *
 * So the catalog is server-only and the formatters stay client-safe. The Settings
 * page (a Server Component) reads it once and passes the bounded list down as
 * serializable props; the browser receives an array of strings and constructs
 * nothing. `server-only` resolves to an empty module under the `react-server`
 * condition, which is exactly how `npm test` and the catalog gate script run it —
 * the same boundary `@/lib/tenant-day` already uses.
 */
import "server-only";

import { DEFAULT_TENANT_TIME_ZONE, isApprovedTenantTimeZone } from "@/lib/time";

/**
 * The timezone options offered in Settings: every canonical zone this runtime
 * knows that SATISFIES THE STORED CONTRACT (`UTC`, or a Region/City identifier),
 * with UTC first.
 *
 * Deliberately NOT `pg_timezone_names`: that carries ~1200 rows including ~600
 * `posix/*` aliases, `Factory`, `Etc/GMT±N` and the legacy abbreviations — an
 * unusable picker, and half of it is unstorable anyway. The filter here is the
 * SAME predicate the Server Action and the database trigger apply, so the picker
 * cannot offer a value that the write path would reject.
 *
 * Computed once per process (pure, bounded, no query, no secret).
 */
export const TIME_ZONE_OPTIONS: readonly string[] = (() => {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [DEFAULT_TENANT_TIME_ZONE];
  // UTC is not part of the canonical Region/City list but must always be offered.
  const all = ["UTC", ...supported.filter((z) => z !== "UTC")];
  // One predicate, shared with the action and (in SQL) the trigger.
  return all.filter((z) => isApprovedTenantTimeZone(z));
})();
