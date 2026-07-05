/**
 * Customer (shop) data access. Mock by default; Supabase branch is
 * server-only local dev (see ./supabase-reads for the access model).
 */
import { customerById, customers } from "@/lib/mock";
import type { Customer } from "@/lib/types";

import { getDataMode } from "./mode";

export async function listCustomers(): Promise<Customer[]> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbListCustomers();
  }
  return customers;
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  if (getDataMode() === "supabase") {
    return (await import("./supabase-reads")).sbGetCustomer(id);
  }
  return customerById.get(id);
}
