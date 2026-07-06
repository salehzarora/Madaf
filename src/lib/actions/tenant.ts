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
