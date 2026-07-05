import type { Order } from "@/lib/types";

/**
 * Mock order requests. `unitPrice` snapshots the package price at order
 * time (matches products.ts today). Dates cluster around "today" in the
 * demo narrative (early July 2026).
 */
export const orders: Order[] = [
  {
    id: "o1047",
    number: "MDF-1047",
    customerId: "c02",
    status: "new",
    createdAt: "2026-07-05T08:40:00+03:00",
    notes: "الرجاء التوصيل قبل الساعة 12 ظهراً — يوجد استلام بضاعة آخر.",
    items: [
      { productId: "p01", quantity: 6, unitPrice: 59.9 },
      { productId: "p03", quantity: 4, unitPrice: 39.5 },
      { productId: "p09", quantity: 3, unitPrice: 47.5 },
      { productId: "p12", quantity: 2, unitPrice: 52.9 },
      { productId: "p24", quantity: 2, unitPrice: 95.9 },
      { productId: "p32", quantity: 3, unitPrice: 71.9 },
    ],
  },
  {
    id: "o1046",
    number: "MDF-1046",
    customerId: "c03",
    status: "new",
    createdAt: "2026-07-05T07:55:00+03:00",
    items: [
      { productId: "p01", quantity: 2, unitPrice: 59.9 },
      { productId: "p04", quantity: 2, unitPrice: 34.9 },
      { productId: "p11", quantity: 1, unitPrice: 57.9 },
      { productId: "p13", quantity: 1, unitPrice: 99.9 },
    ],
  },
  {
    id: "o1045",
    number: "MDF-1045",
    customerId: "c01",
    status: "confirmed",
    createdAt: "2026-07-04T16:20:00+03:00",
    notes: "בבקשה לצרף חשבונית עבור החודש הקודם.",
    items: [
      { productId: "p07", quantity: 10, unitPrice: 11.9 },
      { productId: "p15", quantity: 2, unitPrice: 89.9 },
      { productId: "p19", quantity: 1, unitPrice: 54.9 },
      { productId: "p26", quantity: 1, unitPrice: 62.5 },
      { productId: "p29", quantity: 1, unitPrice: 83.9 },
    ],
  },
  {
    id: "o1044",
    number: "MDF-1044",
    customerId: "c06",
    status: "preparing",
    createdAt: "2026-07-03T11:05:00+03:00",
    notes: "طلبية كبيرة لعطلة نهاية الأسبوع.",
    items: [
      { productId: "p01", quantity: 12, unitPrice: 59.9 },
      { productId: "p02", quantity: 8, unitPrice: 59.9 },
      { productId: "p05", quantity: 6, unitPrice: 36.9 },
      { productId: "p10", quantity: 4, unitPrice: 55.9 },
      { productId: "p16", quantity: 2, unitPrice: 189.9 },
      { productId: "p21", quantity: 3, unitPrice: 89.9 },
      { productId: "p33", quantity: 4, unitPrice: 69.9 },
      { productId: "p34", quantity: 5, unitPrice: 71.4 },
    ],
  },
  {
    id: "o1043",
    number: "MDF-1043",
    customerId: "c05",
    status: "delivered",
    createdAt: "2026-07-01T09:30:00+03:00",
    items: [
      { productId: "p03", quantity: 5, unitPrice: 39.5 },
      { productId: "p09", quantity: 4, unitPrice: 47.5 },
      { productId: "p18", quantity: 3, unitPrice: 27.9 },
      { productId: "p30", quantity: 2, unitPrice: 86.4 },
      { productId: "p35", quantity: 2, unitPrice: 58.8 },
    ],
  },
  {
    id: "o1042",
    number: "MDF-1042",
    customerId: "c04",
    status: "delivered",
    createdAt: "2026-06-29T14:45:00+03:00",
    notes: "تم الاتفاق على خصم 2% — يرجى تحديثه في الفاتورة.",
    items: [
      { productId: "p06", quantity: 3, unitPrice: 41.9 },
      { productId: "p14", quantity: 2, unitPrice: 86.4 },
      { productId: "p17", quantity: 1, unitPrice: 95.9 },
      { productId: "p25", quantity: 2, unitPrice: 118.9 },
      { productId: "p27", quantity: 2, unitPrice: 56.9 },
      { productId: "p31", quantity: 1, unitPrice: 118.8 },
    ],
  },
  {
    id: "o1041",
    number: "MDF-1041",
    customerId: "c08",
    status: "cancelled",
    createdAt: "2026-06-27T10:10:00+03:00",
    notes: "הלקוח ביטל — סגירת החנות לשיפוצים.",
    items: [
      { productId: "p01", quantity: 3, unitPrice: 59.9 },
      { productId: "p12", quantity: 2, unitPrice: 52.9 },
    ],
  },
];

export const orderById = new Map(orders.map((o) => [o.id, o]));

export function orderSubtotal(order: Order): number {
  return order.items.reduce(
    (sum, item) => sum + item.quantity * item.unitPrice,
    0,
  );
}

export function orderLineCount(order: Order): number {
  return order.items.length;
}
