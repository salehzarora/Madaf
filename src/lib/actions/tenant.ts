"use server";

/**
 * Tenant Server Actions (M4A onboarding · M4C tenant switching). Onboarding
 * creates a tenant + owner membership atomically; switching records the
 * selected tenant in a cookie AFTER verifying the caller really belongs to
 * it (the cookie is never trusted on its own — session.ts re-verifies, and
 * every write RPC re-checks membership for the tenant it is given).
 */
import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/config";
import { getSessionContext } from "@/lib/auth/session";
import { writeSelectedTenant } from "@/lib/auth/selected-tenant";
import { updateTenantProfile } from "@/lib/data";
import { createServerAuthClient } from "@/lib/supabase/server-auth";

function isTenantId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-fA-F-]{36}$/.test(value)
  );
}

const MAX_NAME = 200;

function name(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t.length >= 1 && t.length <= MAX_NAME ? t : null;
}

/** Trim + cap an optional free-text field; empty → undefined (clears it). */
function optional(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t ? t.slice(0, max) : undefined;
}

export async function createTenantAction(input: {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  defaultLocale: string;
}): Promise<{ ok: boolean }> {
  try {
    const nameAr = name(input.nameAr);
    const nameHe = name(input.nameHe);
    const nameEn = name(input.nameEn);
    if (!nameAr || !nameHe || !nameEn) return { ok: false };
    const defaultLocale = isLocale(input.defaultLocale)
      ? input.defaultLocale
      : "he";

    const client = await createServerAuthClient();
    const { error } = await client.rpc("create_tenant_with_owner", {
      p_name_ar: nameAr,
      p_name_he: nameHe,
      p_name_en: nameEn,
      p_default_locale: defaultLocale,
    });
    if (error) return { ok: false };
    revalidatePath(`/${defaultLocale}`, "layout");
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] createTenantAction failed:", error);
    return { ok: false };
  }
}

/**
 * M8E.4 — save the tenant BUSINESS PROFILE (owner/admin). NON-LEGAL display
 * settings only; the update_tenant_profile RPC re-gates (authorize_tenant
 * owner/admin) and no client tenant_id is trusted. `displayVatRatePct` is
 * entered as a percent (e.g. 18) and stored as a fraction in [0,1) — an
 * ESTIMATE rate for drafts, never a legal figure. Returns {ok}; never throws
 * to the client.
 */
export async function saveBusinessProfileAction(input: {
  nameAr: string;
  nameHe: string;
  nameEn: string;
  phone?: string;
  email?: string;
  addressAr?: string;
  addressHe?: string;
  addressEn?: string;
  legalName?: string;
  companyId?: string;
  displayVatRatePct?: string | number | null;
  /** Object path or external URL to persist; empty clears the logo. */
  logoUrl?: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    const nameAr = name(input.nameAr);
    const nameHe = name(input.nameHe);
    const nameEn = name(input.nameEn);
    if (!nameAr || !nameHe || !nameEn) return { ok: false };

    // VAT entered as a percent (0–100) → fraction in [0,1). Blank clears it.
    let displayVatRate: number | undefined;
    const rawPct = input.displayVatRatePct;
    if (rawPct !== undefined && rawPct !== null && `${rawPct}`.trim() !== "") {
      const pct = Number(rawPct);
      if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return { ok: false };
      displayVatRate = Math.round((pct / 100) * 10000) / 10000; // 4dp fraction
    }

    const email = optional(input.email, 254);
    if (email && !email.includes("@")) return { ok: false };

    const logoUrl =
      typeof input.logoUrl === "string" ? input.logoUrl.trim().slice(0, 500) : "";

    await updateTenantProfile({
      nameAr,
      nameHe,
      nameEn,
      phone: optional(input.phone, 40),
      email,
      addressAr: optional(input.addressAr, 200),
      addressHe: optional(input.addressHe, 200),
      addressEn: optional(input.addressEn, 200),
      legalName: optional(input.legalName, 200),
      companyId: optional(input.companyId, 40),
      displayVatRate,
      logoUrl,
    });

    if (isLocale(input.locale)) {
      // The business name/logo feed the admin shell + documents everywhere.
      revalidatePath(`/${input.locale}`, "layout");
      revalidatePath(`/${input.locale}/admin/settings/business`);
    }
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] saveBusinessProfileAction failed:", error);
    return { ok: false };
  }
}

/**
 * Switch the current tenant. Only succeeds if the caller actually belongs to
 * the requested tenant — the cookie can never select a tenant the user is
 * not a member of.
 */
export async function selectTenantAction(input: {
  tenantId: string;
  locale: string;
}): Promise<{ ok: boolean }> {
  try {
    if (!isTenantId(input.tenantId)) return { ok: false };
    const { memberships } = await getSessionContext();
    if (!memberships.some((m) => m.tenantId === input.tenantId)) {
      return { ok: false };
    }
    await writeSelectedTenant(input.tenantId);
    const locale = isLocale(input.locale) ? input.locale : "he";
    revalidatePath(`/${locale}`, "layout");
    return { ok: true };
  } catch (error) {
    console.error("[madaf/actions] selectTenantAction failed:", error);
    return { ok: false };
  }
}
