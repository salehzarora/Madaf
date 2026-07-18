/**
 * M8I.7 — bounded, paginated Admin Documents listing. Proves listDocumentsPage
 * (mock branch — the exact contract the Supabase branch mirrors) is a real,
 * newest-first, page-bounded read: it never returns more than the (clamped) page
 * size, clamps an out-of-range page to the last one, paginates without overlap or
 * gaps, and page-scoped enrichment resolves each row's order number + customer.
 *
 * The Supabase behavioural equivalent runs over live PostgREST; this pins the
 * bounded/ordering/enrichment contract deterministically against the mock data.
 *
 * Runner: `npm run test:documents-page`.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCUMENTS_PAGE_SIZE, listDocumentsPage } from "@/lib/data";

const ROW_KEYS = ["id", "type", "number", "date", "orderNumber", "customerName"].sort();
const inOrder = (a: { date: string; id: string }, b: { date: string; id: string }) =>
  a.date > b.date || (a.date === b.date && a.id >= b.id);

test("the default page is bounded to DOCUMENTS_PAGE_SIZE and never larger", async () => {
  assert.equal(DOCUMENTS_PAGE_SIZE, 25);
  const r = await listDocumentsPage(1);
  assert.equal(r.page, 1);
  assert.equal(r.pageSize, DOCUMENTS_PAGE_SIZE);
  assert.ok(r.rows.length <= r.pageSize, "never more rows than the page size");
  assert.ok(r.total >= r.rows.length, "total is at least the rows on this page");
});

test("rows carry exactly the projected fields and a resolved order number", async () => {
  const { rows } = await listDocumentsPage(1);
  assert.ok(rows.length > 0, "the mock dataset has documents");
  for (const row of rows) {
    assert.deepEqual(Object.keys(row).sort(), ROW_KEYS, "row is the bounded projection only");
    assert.ok(["order", "delivery", "invoiceDraft"].includes(row.type), "known document type");
    assert.equal(typeof row.number, "string");
    assert.equal(typeof row.orderNumber, "string", "each mock document resolves its order number");
    assert.ok(row.customerName === null || typeof row.customerName === "string");
  }
});

test("a small page size paginates without overlap or gaps, newest-first", async () => {
  const size = 3;
  const first = await listDocumentsPage(1, size);
  assert.equal(first.pageSize, size);
  assert.ok(first.total >= 4, "enough mock documents to span multiple pages at size 3");
  assert.equal(first.totalPages, Math.ceil(first.total / size));
  assert.ok(first.totalPages >= 2, "multiple pages at size 3");

  const seen: string[] = [];
  let prev: { date: string; id: string } | null = null;
  for (let p = 1; p <= first.totalPages; p++) {
    const page = await listDocumentsPage(p, size);
    assert.equal(page.page, p);
    assert.ok(page.rows.length <= size, "each page is bounded");
    if (p < first.totalPages) assert.equal(page.rows.length, size, "full pages before the last");
    for (const row of page.rows) {
      seen.push(row.id);
      if (prev) assert.ok(inOrder(prev, row), "globally newest-first (date desc, id desc)");
      prev = { date: row.date, id: row.id };
    }
  }
  assert.equal(seen.length, first.total, "every document appears exactly once across pages");
  assert.equal(new Set(seen).size, first.total, "no document is repeated across pages");
});

test("an out-of-range page clamps to the last page (never empty/negative)", async () => {
  const size = 3;
  const meta = await listDocumentsPage(1, size);
  const high = await listDocumentsPage(9999, size);
  assert.equal(high.page, meta.totalPages, "a too-high page clamps to the last page");
  assert.ok(high.rows.length >= 1, "the last page still has rows");

  const low = await listDocumentsPage(0, size);
  assert.equal(low.page, 1, "page 0 clamps up to 1");
  const neg = await listDocumentsPage(-5, size);
  assert.equal(neg.page, 1, "a negative page clamps up to 1");
});

test("the page size is clamped to a safe [1, 100] band", async () => {
  const huge = await listDocumentsPage(1, 5000);
  assert.ok(huge.pageSize <= 100 && huge.pageSize < 5000, "an oversized page size is clamped down");
  const zero = await listDocumentsPage(1, 0);
  assert.ok(zero.pageSize >= 1, "a zero/negative page size is clamped up to at least 1");
});
