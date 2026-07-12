import type { Customer } from "@/lib/types";

/** Shops the demo supplier serves. Names are proper nouns (kept as-is). */
export const customers: Customer[] = [
  {
    id: "c01",
    name: "מכולת אבו יוסף",
    type: "grocery",
    city: { he: "נצרת", ar: "الناصرة", en: "Nazareth" },
    phone: "04-555-0101",
    contactName: "יוסף חורי",
    origin: "manual",
  },
  {
    id: "c02",
    name: "سوبرماركت النور",
    type: "supermarket",
    city: { he: "אום אל-פחם", ar: "أم الفحم", en: "Umm al-Fahm" },
    phone: "04-555-0102",
    contactName: "محمد اغبارية",
    origin: "signup",
  },
  {
    id: "c03",
    name: "קיוסק הכיכר",
    type: "kiosk",
    city: { he: "חיפה", ar: "حيفا", en: "Haifa" },
    phone: "04-555-0103",
    contactName: "רוני לוי",
    origin: "guest_conversion",
  },
  {
    id: "c04",
    name: "بقالة الأمل",
    type: "grocery",
    city: { he: "כפר קרע", ar: "كفر قرع", en: "Kafr Qara" },
    phone: "04-555-0104",
    contactName: "أحمد مصاروة",
    origin: "legacy_unknown",
  },
  {
    id: "c05",
    name: "מינימרקט גל",
    type: "minimarket",
    city: { he: "עפולה", ar: "العفولة", en: "Afula" },
    phone: "04-555-0105",
    contactName: "גלית כהן",
    origin: "manual",
  },
  {
    id: "c06",
    name: "مركز التوفير",
    type: "supermarket",
    city: { he: "באקה אל-גרביה", ar: "باقة الغربية", en: "Baqa al-Gharbiyye" },
    phone: "04-555-0106",
    contactName: "سامر بيادسة",
    origin: "signup",
  },
  {
    id: "c07",
    name: "סופר שכונתי כרמל",
    type: "minimarket",
    city: { he: "חיפה", ar: "حيفا", en: "Haifa" },
    phone: "04-555-0107",
    contactName: "אבי מזרחי",
    origin: "legacy_unknown",
  },
  {
    id: "c08",
    name: "קיוסק התחנה",
    type: "kiosk",
    city: { he: "חדרה", ar: "الخضيرة", en: "Hadera" },
    phone: "04-555-0108",
    contactName: "משה פרץ",
    origin: "guest_conversion",
  },
];

export const customerById = new Map(customers.map((c) => [c.id, c]));
