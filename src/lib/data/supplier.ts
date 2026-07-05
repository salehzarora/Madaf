/**
 * Supplier (tenant) data access. Mock by default; the Supabase branch is
 * server-only and reads the tenant row under RLS — scoped to the signed-in
 * user's membership tenant (resolved in `getDataContext`, M4A). Anon callers
 * see zero rows.
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
