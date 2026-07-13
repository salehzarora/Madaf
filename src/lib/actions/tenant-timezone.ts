"use server";

/**
 * Tenant timezone Server Action (M8H.2) — the ONLY client bridge to the timezone
 * write.
 *
 * The browser sends nothing but a candidate IANA name. It never sends the tenant
 * (server-derived), never sends its own device zone as an authority, and cannot
 * reach the table directly: the DB re-verifies owner/admin through
 * authorize_tenant and validates the name against pg_timezone_names (a table
 * trigger enforces the same on ANY write path).
 *
 * Changing the timezone rewrites NO stored instant. It changes how times are
 * DISPLAYED and how future tenant-local date filters are resolved, so the cached
 * admin pages are revalidated.
 */
import { revalidatePath } from "next/cache";

import { updateTenantTimeZone } from "@/lib/data";
import { isValidTimeZone } from "@/lib/time";

export interface TimeZoneActionResult {
  ok: boolean;
  /** The persisted IANA name on success. */
  timezone?: string;
  /** A stable reason code the UI localizes (never a raw DB message). */
  error?: "invalid" | "forbidden" | "failed";
}

export async function updateTenantTimeZoneAction(input: {
  timezone: string;
  locale?: string;
}): Promise<TimeZoneActionResult> {
  try {
    const candidate = typeof input.timezone === "string" ? input.timezone.trim() : "";
    // Cheap client-shaped guard; the DB remains the authority (and rejects a
    // fixed offset such as "+03:00", which cannot express DST).
    if (!isValidTimeZone(candidate)) return { ok: false, error: "invalid" };

    const saved = await updateTenantTimeZone(candidate);

    // Every business time on every admin screen is rendered from this value, so
    // the cached admin tree must re-render. Stored instants are untouched.
    if (typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)) {
      revalidatePath(`/${input.locale}/admin`, "layout");
    }
    return { ok: true, timezone: saved };
  } catch (error) {
    console.error("[madaf/actions] updateTenantTimeZoneAction failed:", error);
    const message = error instanceof Error ? error.message : "";
    // authorize_tenant raises 42501 for a sales_rep / non-member / cross-tenant.
    if (/42501|not permitted|not a member/i.test(message)) {
      return { ok: false, error: "forbidden" };
    }
    if (/22023|not a recognized IANA/i.test(message)) {
      return { ok: false, error: "invalid" };
    }
    return { ok: false, error: "failed" };
  }
}
