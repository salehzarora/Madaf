/**
 * Customer (shop) data access.
 *
 * M1: mock-backed. M2 mapping: Customer.city.{ar,he,en} ← customers.
 * city_ar/he/en; Customer.type ← customers.customer_type; shop names are
 * proper nouns stored once in customers.name.
 */
import { customerById, customers } from "@/lib/mock";
import type { Customer } from "@/lib/types";

import { getDataMode, supabaseNotWiredYet } from "./mode";

export async function listCustomers(): Promise<Customer[]> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("listCustomers");
  return customers;
}

export async function getCustomer(id: string): Promise<Customer | undefined> {
  if (getDataMode() === "supabase") supabaseNotWiredYet("getCustomer");
  return customerById.get(id);
}
