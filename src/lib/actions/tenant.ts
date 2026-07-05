"use server";

/**
 * Tenant onboarding Server Action (M4A). A signed-in user with no
 * membership creates their tenant and becomes its owner, atomically, via
 * the `create_tenant_with_owner` RPC (auth derived from auth.uid()).
 */
import { revalidatePath } from "next/cache";

import { isLocale } from "@/i18n/config";
import { createServerAuthClient } from "@/lib/supabase/server-auth";

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
