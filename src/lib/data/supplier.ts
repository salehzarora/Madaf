/**
 * Supplier (tenant) data access.
 *
 * M1: mock-backed single demo tenant. M2 mapping: Supplier ← tenants row
 * (name_ar/he/en, legal_name, company_id, phone, address_ar/he/en). The
 * mock phase is single-tenant; tenant resolution (which tenant the signed-
 * in user acts for) arrives with auth in M4.
 */
import { supplier } from "@/lib/mock";
import type { Supplier } from "@/lib/types";

import { getDataMode, supabaseNotWiredYet } from "./mode";

export async function getSupplier(): Promise<Supplier> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getSupplier");
  return supplier;
}
