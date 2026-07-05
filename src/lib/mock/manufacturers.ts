import type { Manufacturer } from "@/lib/types";

export const manufacturers: Manufacturer[] = [
  {
    id: "m-coca",
    name: { he: "קוקה-קולה", ar: "كوكا كولا", en: "Coca-Cola" },
  },
  {
    id: "m-strauss",
    name: { he: "שטראוס", ar: "شتراوس", en: "Strauss" },
  },
  {
    id: "m-osem",
    name: { he: "אסם", ar: "أوسم", en: "Osem" },
  },
  {
    id: "m-elite",
    name: { he: "עלית", ar: "عيليت", en: "Elite" },
  },
  {
    id: "m-tara",
    name: { he: "טרה", ar: "تارا", en: "Tara" },
  },
  {
    id: "m-local",
    name: { he: "מדף מקומי", ar: "مدف المحلي", en: "Madaf Local" },
  },
];

export const manufacturerById = new Map(manufacturers.map((m) => [m.id, m]));
