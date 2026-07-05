import type { InventoryItem } from "@/lib/types";

/** Mock warehouse stock. Expiry dates only where products track them. */
export const inventory: InventoryItem[] = [
  { productId: "p01", stockPackages: 84, location: "A-01" },
  { productId: "p02", stockPackages: 61, location: "A-02" },
  { productId: "p03", stockPackages: 45, location: "A-03" },
  { productId: "p04", stockPackages: 7, location: "A-04" },
  { productId: "p05", stockPackages: 32, location: "A-05" },
  { productId: "p06", stockPackages: 28, location: "A-06" },
  { productId: "p07", stockPackages: 120, location: "A-07" },
  { productId: "p09", stockPackages: 44, location: "B-01" },
  { productId: "p10", stockPackages: 37, location: "B-02" },
  { productId: "p11", stockPackages: 6, location: "B-03" },
  { productId: "p12", stockPackages: 25, location: "B-04" },
  {
    productId: "p13",
    stockPackages: 18,
    location: "B-05",
    nearestExpiry: "2026-11-15",
  },
  { productId: "p14", stockPackages: 22, location: "B-06" },
  { productId: "p15", stockPackages: 31, location: "C-01" },
  { productId: "p16", stockPackages: 4, location: "C-02" },
  { productId: "p17", stockPackages: 16, location: "C-03" },
  { productId: "p18", stockPackages: 40, location: "D-01" },
  { productId: "p19", stockPackages: 27, location: "D-02" },
  { productId: "p20", stockPackages: 19, location: "D-03" },
  { productId: "p21", stockPackages: 33, location: "D-04" },
  { productId: "p22", stockPackages: 8, location: "D-05" },
  { productId: "p23", stockPackages: 26, location: "D-06" },
  { productId: "p24", stockPackages: 21, location: "E-01" },
  { productId: "p25", stockPackages: 9, location: "E-02" },
  { productId: "p26", stockPackages: 38, location: "E-03" },
  { productId: "p27", stockPackages: 17, location: "E-04" },
  { productId: "p28", stockPackages: 0, location: "E-05" },
  { productId: "p29", stockPackages: 23, location: "E-06" },
  { productId: "p30", stockPackages: 29, location: "E-07" },
  { productId: "p31", stockPackages: 14, location: "E-08" },
  {
    productId: "p32",
    stockPackages: 24,
    location: "F-01",
    nearestExpiry: "2026-07-18",
  },
  {
    productId: "p33",
    stockPackages: 5,
    location: "F-02",
    nearestExpiry: "2026-07-14",
  },
  {
    productId: "p34",
    stockPackages: 15,
    location: "F-03",
    nearestExpiry: "2026-07-22",
  },
  {
    productId: "p35",
    stockPackages: 11,
    location: "F-04",
    nearestExpiry: "2026-07-25",
  },
];

export const inventoryByProductId = new Map(
  inventory.map((item) => [item.productId, item]),
);
