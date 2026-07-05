/**
 * Supplier (tenant) data access. Mock by default; Supabase branch is
 * server-only local dev reading the demo tenants row. Tenant resolution
 * from the signed-in user arrives with auth in M4.
 */
import { supplier } from "@/lib/mock";
import type { Supplier } from "@/lib/types";

import { getDataMode } from "./mode";

export async function getSupplier(): Promise<Supplier> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetSupplier();
  }
  return supplier;
}
