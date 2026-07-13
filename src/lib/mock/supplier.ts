import type { Supplier } from "@/lib/types";

/** The demo supplier tenant. All values are mock. */
export const supplier: Supplier = {
  id: "sup-demo",
  name: {
    he: "מדף הפצה",
    ar: "مدف للتوزيع",
    en: "Madaf Distribution",
  },
  legalName: 'מדף הפצה בע"מ (דמו)',
  companyId: "515123456", // mock ח.פ
  phone: "052-555-0123",
  address: {
    he: "רח׳ הנמל 12, חיפה",
    ar: "شارع الميناء 12، حيفا",
    en: "12 HaNamal St., Haifa",
  },
  email: "orders@madaf.demo",
  // display VAT rate omitted → falls back to VAT_RATE (0.18) on estimates.
  // M8H.2 — the demo tenant's IANA timezone. Mock mirrors the Supabase contract:
  // every business time renders in THIS zone, never the device's.
  timezone: "Asia/Jerusalem",
};
