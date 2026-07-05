import type { Category } from "@/lib/types";

export const categories: Category[] = [
  {
    id: "cat-drinks",
    name: { he: "משקאות", ar: "مشروبات", en: "Drinks" },
    icon: "🥤",
    hue: 197,
  },
  {
    id: "cat-snacks",
    name: { he: "חטיפים ומתוקים", ar: "سناكات وحلويات", en: "Snacks & Sweets" },
    icon: "🥨",
    hue: 28,
  },
  {
    id: "cat-coffee",
    name: { he: "קפה ותה", ar: "قهوة وشاي", en: "Coffee & Tea" },
    icon: "☕",
    hue: 25,
  },
  {
    id: "cat-canned",
    name: {
      he: "שימורים ויבשים",
      ar: "معلبات ومواد جافة",
      en: "Canned & Pantry",
    },
    icon: "🥫",
    hue: 8,
  },
  {
    id: "cat-dairy",
    name: { he: "מוצרי חלב", ar: "ألبان", en: "Dairy" },
    icon: "🥛",
    hue: 210,
  },
  {
    id: "cat-cleaning",
    name: { he: "ניקיון וחד־פעמי", ar: "تنظيف ومستهلكات", en: "Cleaning" },
    icon: "🧼",
    hue: 168,
  },
];

export const categoryById = new Map(categories.map((c) => [c.id, c]));
