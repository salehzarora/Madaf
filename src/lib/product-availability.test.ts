/**
 * PILOT-READINESS-BATCH-B · B2 — availability / orderability derivation
 * (P2 correction, Shop-orderability outcome).
 *
 * The whole point of the B2 fix is that an inventory-less product stays
 * ORDERABLE (In-stock) after an unrelated metadata edit, and that turning
 * tracking on with quantity 0 makes it Out-of-stock. Availability is DERIVED
 * from the inventory state, and orderability is `availability === "outOfStock"`
 * in every ordering surface. This suite exercises the REAL production
 * derivation functions (no fake reimplementation) — ALL THREE copies that gate
 * ordering:
 *   - the public shop `/shop/<token>` copy in src/lib/data/token.ts,
 *   - the admin + `/product/[id]` copy in src/lib/data/supabase-reads.ts, and
 *   - the public showcase `/showcase/<token>` copy in src/lib/data/catalog-showcase.ts.
 *
 * (All are imported under `--conditions=react-server`, where `server-only`
 * resolves to a no-op — the same way orders-export.live.test.ts imports from a
 * server-only module.)
 *
 * NOTE (backlog): the derivation is duplicated across those three modules;
 * consolidating them into one shared helper is a separate, non-blocking
 * refactor (out of scope for this P2 correction).
 *
 * Runner: `npm run test:product-availability`.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import { deriveAvailability as deriveShopAvailability } from "@/lib/data/token";
import { deriveAvailability as deriveAdminAvailability } from "@/lib/data/supabase-reads";
import { deriveAvailability as deriveShowcaseAvailability } from "@/lib/data/catalog-showcase";

// ══ Public shop derivation (token.ts) — what shop-view.tsx reads ═════════════

test("shop: an untracked product (no quantity) is In-stock → orderable", () => {
  assert.equal(deriveShopAvailability(undefined, undefined), "inStock");
  assert.equal(deriveShopAvailability(null, 10), "inStock");
  // Orderability gate: soldOut === false.
  assert.notEqual(deriveShopAvailability(undefined, undefined), "outOfStock");
});

test("shop: a tracked product at quantity 0 is Out-of-stock → NOT orderable", () => {
  assert.equal(deriveShopAvailability(0, 10), "outOfStock");
  assert.equal(deriveShopAvailability(0, 0), "outOfStock");
});

test("shop: below-threshold is Low-stock (still orderable); at/above is In-stock", () => {
  assert.equal(deriveShopAvailability(3, 10), "lowStock");
  assert.notEqual(deriveShopAvailability(3, 10), "outOfStock");
  assert.equal(deriveShopAvailability(10, 10), "inStock");
  assert.equal(deriveShopAvailability(50, 10), "inStock");
});

// ══ Admin / product-detail derivation (supabase-reads.ts) ════════════════════

test("admin: no inventory row → In-stock (orderable); it must not read as out-of-stock", () => {
  assert.equal(deriveAdminAvailability(null), "inStock");
  assert.notEqual(deriveAdminAvailability(null), "outOfStock");
});

test("admin: a row at quantity 0 → Out-of-stock", () => {
  assert.equal(
    deriveAdminAvailability({ quantity_available: 0, low_stock_threshold: 10 }),
    "outOfStock",
  );
});

test("admin: below-threshold → Low-stock; at/above → In-stock", () => {
  assert.equal(
    deriveAdminAvailability({ quantity_available: 3, low_stock_threshold: 10 }),
    "lowStock",
  );
  assert.equal(
    deriveAdminAvailability({ quantity_available: 50, low_stock_threshold: 10 }),
    "inStock",
  );
});

// ══ Showcase derivation (catalog-showcase.ts) — guest ordering surface ═══════

test("showcase: no quantity → In-stock; quantity 0 → Out-of-stock; below → Low-stock", () => {
  assert.equal(deriveShowcaseAvailability(undefined, undefined), "inStock");
  assert.equal(deriveShowcaseAvailability(0, 10), "outOfStock");
  assert.equal(deriveShowcaseAvailability(3, 10), "lowStock");
  assert.equal(deriveShowcaseAvailability(50, 10), "inStock");
});

// ══ All three order-gating derivations agree on the critical states ══════════

test("all three derivations agree on the two orderability-critical states", () => {
  // No inventory → In-stock (orderable) in shop, admin AND showcase.
  assert.equal(deriveShopAvailability(undefined, undefined), "inStock");
  assert.equal(deriveAdminAvailability(null), "inStock");
  assert.equal(deriveShowcaseAvailability(undefined, undefined), "inStock");
  // Quantity 0 → Out-of-stock in all three.
  assert.equal(deriveShopAvailability(0, 10), "outOfStock");
  assert.equal(
    deriveAdminAvailability({ quantity_available: 0, low_stock_threshold: 10 }),
    "outOfStock",
  );
  assert.equal(deriveShowcaseAvailability(0, 10), "outOfStock");
});

// ══ Orderability wiring — every ordering surface COMPUTES soldOut from
// availability (a source guard; the disable/branch wiring itself is
// pre-existing and unchanged by this fix). ══════════════════════════════════

test("guard: every ordering surface computes soldOut from availability === outOfStock", () => {
  const stripComments = (s: string): string =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (rel: string): string =>
    stripComments(readFileSync(join(process.cwd(), "src", rel), "utf8"));
  const SURFACES = [
    "components/product-detail-actions.tsx",
    "components/product-card.tsx",
    "components/shop/shop-view.tsx",
    "components/shop/showcase-view.tsx",
  ];
  for (const rel of SURFACES) {
    assert.match(
      read(rel),
      /soldOut = product\.availability === "outOfStock"/,
      `${rel} must derive soldOut from availability === "outOfStock"`,
    );
  }
});
