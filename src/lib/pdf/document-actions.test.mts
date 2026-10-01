import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { getDictionary } from "@/i18n/dictionaries";
import { locales } from "@/i18n/config";

const source = { orderNumber: "MDF-1001", publicRef: "MDF-SAFE1234", orderDate: "2026-09-30T10:00:00Z" };
const record = { documentId: "doc-id", documentNumber: "DOC-SAFE1234-O", documentDate: source.orderDate, storagePath: "private/object.pdf" };
const read = mock.fn<(id: string) => Promise<typeof source | undefined>>(async () => source);
const save = mock.fn<(input: unknown) => Promise<typeof record>>(async () => ({ ...record }));
const sign = mock.fn<(input: unknown) => Promise<string>>(async () => "https://storage.example/signed");
const store = mock.fn<(input: unknown) => Promise<string | null>>(async () => null);
const render = mock.fn<(input: unknown) => Promise<Uint8Array>>(async () => new Uint8Array(Buffer.from("%PDF-1.4\nactual-bytes")));
mock.module("@/lib/data", { namedExports: { getOrderDocumentSource: read, recordOrderDocument: save, signStoredDocument: sign, storeDocumentPdf: store } });
mock.module("@/lib/pdf/render-document", { namedExports: { renderOrderDocumentPdf: render } });
const { GET } = await import("@/app/[locale]/admin/orders/[id]/documents/[type]/route");

beforeEach(() => {
  mock.method(console, "warn", () => {});
  for (const fn of [read, save, sign, store, render]) fn.mock.resetCalls();
  read.mock.mockImplementation(async () => source);
  save.mock.mockImplementation(async () => ({ ...record }));
  store.mock.mockImplementation(async () => null);
  render.mock.mockImplementation(async () => new Uint8Array(Buffer.from("%PDF-1.4\nactual-bytes")));
});
afterEach(() => mock.restoreAll());

function request(query = "", type = "order", locale = "ar") {
  return GET(new Request(`https://madaf.example/${locale}/admin/orders/order-id/documents/${type}${query}`), {
    params: Promise.resolve({ locale, id: "order-id", type }),
  });
}

for (const type of ["order", "delivery", "invoiceDraft"]) {
  test(`${type}: Share returns same-origin inline bytes after access + record; never signs/stores`, async () => {
    const response = await request("?mode=share", type);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "application/pdf");
    assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="DOC-SAFE1234-O.pdf"');
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Location"), null);
    assert.equal(await response.text(), "%PDF-1.4\nactual-bytes");
    assert.deepEqual(read.mock.calls[0].arguments, ["order-id"]);
    assert.deepEqual(save.mock.calls[0].arguments, [{ orderId: "order-id", ...source, type, locale: "he", legalNotice: type === "invoiceDraft" ? getDictionary("he").docs.notLegalNotice : null }]);
    assert.deepEqual(render.mock.calls[0].arguments, [{ source, docType: type, docNumber: record.documentNumber, docDate: record.documentDate, docLocale: "he" }]);
    assert.equal(sign.mock.callCount(), 0);
    assert.equal(store.mock.callCount(), 0);
  });
}

for (const locale of locales) {
  test(`explicit document ${locale} retains localized invoice draft legal notice`, async () => {
    await request(`?mode=share&lang=${locale}`, "invoiceDraft", "en");
    assert.equal((save.mock.calls[0].arguments[0] as { legalNotice: string }).legalNotice, getDictionary(locale).docs.notLegalNotice);
    assert.equal((render.mock.calls[0].arguments[0] as { docLocale: string }).docLocale, locale);
  });
}

test("invalid document language still defaults to Hebrew", async () => {
  await request("?mode=share&lang=invalid");
  assert.equal((render.mock.calls[0].arguments[0] as { docLocale: string }).docLocale, "he");
});

for (const [query, type, locale, status] of [
  ["?mode=public", "order", "ar", 400],
  ["?mode=share", "taxInvoice", "ar", 404],
  ["?mode=share", "order", "invalid", 404],
] as const) {
  test(`invalid mode/type/locale rejected: ${query}/${type}/${locale}`, async () => {
    assert.equal((await request(query, type, locale)).status, status);
    assert.equal(read.mock.callCount(), 0);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(render.mock.callCount(), 0);
    assert.equal((console.warn as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 0);
  });
}

for (const query of ["?mode=share", ""]) {
  test(`${query || "Download"}: inaccessible order stops before recording/rendering/storage`, async () => {
    read.mock.mockImplementation(async () => undefined);
    assert.equal((await request(query)).status, 404);
    assert.equal(save.mock.callCount(), 0);
    assert.equal(render.mock.callCount(), 0);
    assert.equal(sign.mock.callCount() + store.mock.callCount(), 0);
    assert.equal((console.warn as unknown as ReturnType<typeof mock.fn>).mock.callCount(), 0);
  });
  test(`${query || "Download"}: revoked record access fails closed without exposing details`, async () => {
    save.mock.mockImplementation(async () => { throw new Error("private provider details"); });
    const response = await request(query);
    assert.equal(response.status, 403);
    assert.equal(await response.text(), "");
    assert.equal(render.mock.callCount(), 0);
    assert.equal(sign.mock.callCount() + store.mock.callCount(), 0);
    const calls = (console.warn as unknown as ReturnType<typeof mock.fn>).mock.calls;
    assert.equal(calls.length, 1, "one neutral warning, no duplicated route logging");
    const event = JSON.parse(calls[0].arguments[0] as string);
    assert.equal(event.event, "document_record_unavailable");
    assert.equal(event.severity, "warning", "ambiguous access/RPC failure is not labeled an outage");
    assert.equal(event.operation, "document_prepare");
    assert.doesNotMatch(JSON.stringify(event), /private provider|order-id|doc-id|MDF-|DOC-|private\/object|signed/);
  });
}

test("unsafe authoritative filename characters cannot enter headers", async () => {
  save.mock.mockImplementation(async () => ({ ...record, documentNumber: 'DOC/../../bad"\r\nname' }));
  const response = await request("?mode=share");
  assert.equal(response.headers.get("Content-Disposition"), 'inline; filename="DOC_______bad___name.pdf"');
  assert.equal((render.mock.calls[0].arguments[0] as { docNumber: string }).docNumber, 'DOC/../../bad"\r\nname');
});

test("recording failure plus throwing diagnostic sink retains empty 403 without rendering", async () => {
  save.mock.mockImplementation(async () => { throw new Error("SECRET token URL email PDF body"); });
  const sink = mock.method(console, "warn", () => { throw new Error("sink unavailable"); });
  const response = await request("?mode=share");
  assert.equal(response.status, 403);
  assert.equal(await response.text(), "");
  assert.equal(render.mock.callCount(), 0);
  assert.equal(sink.mock.callCount(), 1);
});

test("unexpected recording failure produces a bounded warning without changing Download outcome", async () => {
  save.mock.mockImplementation(async () => { throw new Error("database offline SECRET customer@example.test"); });
  const response = await request();
  assert.equal(response.status, 403);
  const calls = (console.warn as unknown as ReturnType<typeof mock.fn>).mock.calls;
  assert.equal(calls.length, 1);
  const line = calls[0].arguments[0] as string;
  assert.ok(line.length < 512);
  assert.equal(JSON.parse(line).event, "document_record_unavailable");
  assert.doesNotMatch(line, /SECRET|database offline|customer@/);
});

test("Download freshly renders an authorized same-origin attachment", async () => {
  const response = await request();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Location"), null);
  assert.equal(sign.mock.callCount(), 0);
  assert.equal(render.mock.callCount(), 1);
  assert.equal(store.mock.callCount(), 0);
});

for (const query of ["", "?mode=download", "?regenerate=1"]) {
  test(`${query || "Download"}: existing stored PDF cannot bypass fresh financial source`, async () => {
    store.mock.mockImplementation(async () => "https://storage.example/mutable");
    const response = await request(query);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Location"), null);
    assert.equal(await response.text(), "%PDF-1.4\nactual-bytes");
    assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="DOC-SAFE1234-O.pdf"');
    assert.equal(sign.mock.callCount(), 0);
    assert.equal(store.mock.callCount(), 0);
  });
}

test("Regenerate remains a fresh attachment without mutable storage", async () => {
  const response = await request("?regenerate=1");
  assert.equal(response.status, 200);
  assert.equal(sign.mock.callCount(), 0);
  assert.equal(render.mock.callCount(), 1);
  assert.equal(store.mock.callCount(), 0);
  assert.equal(response.headers.get("Content-Disposition"), 'attachment; filename="DOC-SAFE1234-O.pdf"');
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
});

test("same stored path returns the current coherent money after a committed edit", async () => {
  const versions = [
    { ...source, items: [{ quantity: 1, unitPrice: 10, lineTotal: 10 }], totals: { subtotal: 10, vatTotal: 1.8, total: 11.8 } },
    { ...source, items: [{ quantity: 3, unitPrice: 10, lineTotal: 30 }], totals: { subtotal: 30, vatTotal: 5.4, total: 35.4 } },
  ];
  render.mock.mockImplementation(async (input) => new Uint8Array(Buffer.from(
    "%PDF-1.4\n" + JSON.stringify((input as { source: unknown }).source),
  )));
  for (const version of versions) {
    read.mock.mockImplementation(async () => version);
    const response = await request();
    assert.equal(response.status, 200);
    assert.deepEqual(JSON.parse((await response.text()).split("\n")[1]), version);
  }
  assert.equal(read.mock.callCount(), 2, "one coherent source per request");
  assert.equal(sign.mock.callCount(), 0);
  assert.equal(store.mock.callCount(), 0);
});

test("fresh render failure cannot fall back to a previously stored PDF", async () => {
  render.mock.mockImplementation(async () => { throw new Error("synthetic render failed"); });
  await assert.rejects(request(), /synthetic render failed/);
  assert.equal(sign.mock.callCount() + store.mock.callCount(), 0);
});
