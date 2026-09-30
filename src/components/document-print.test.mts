import "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { JSDOM } from "jsdom";
import { getDictionary } from "@/i18n/dictionaries";
import { locales } from "@/i18n/config";
import { products, customers, supplier, orders, documentById } from "@/lib/mock";
import { getOrderDocumentSource, recordOrderDocument } from "@/lib/data/documents";
import type { DocumentType } from "@/lib/types";

const read = mock.fn(getOrderDocumentSource);
const record = mock.fn(recordOrderDocument);
const orderRead = mock.fn(async (id: string) => orders.find((order) => order.id === id));
mock.module("server-only", { namedExports: {} });
mock.module("next/navigation", { namedExports: { notFound: () => { throw new Error("not-found"); } } });
mock.module("@/lib/data", { namedExports: {
  getOrderDocumentSource: read, recordOrderDocument: record, getOrder: orderRead,
  getSupplier: async () => supplier, listProducts: async () => products,
  listCustomers: async () => customers, getDocument: async (id: string) => documentById.get(id),
} });
const { default: PrintPage, dynamic } = await import("@/app/[locale]/admin/orders/[id]/documents/[type]/print/page");
const { default: PreviewPage } = await import("@/app/[locale]/admin/documents/[id]/page");
const { DocumentPreview } = await import("./document-preview");

beforeEach(() => {
  read.mock.resetCalls(); record.mock.resetCalls(); orderRead.mock.resetCalls();
  read.mock.mockImplementation(getOrderDocumentSource);
  record.mock.mockImplementation(recordOrderDocument);
  orderRead.mock.mockImplementation(async (id) => orders.find((order) => order.id === id));
});
function page(type: string = "order", locale = "en", id = "o1047") {
  return PrintPage({ params: Promise.resolve({ locale, id, type }) });
}
async function sheet(type: DocumentType, locale = "en") {
  const entry = await page(type, locale);
  return DocumentPreview(entry.props);
}

test("print entry remains request-time and rejects invalid SAFE type/locale before access", async () => {
  assert.equal(dynamic, "force-dynamic");
  await assert.rejects(page("taxInvoice"), /not-found/);
  await assert.rejects(page("order", "invalid"), /not-found/);
  assert.equal(read.mock.callCount(), 0);
  assert.equal(record.mock.callCount(), 0);
});
test("print rejects inaccessible/missing orders before recording", async () => {
  read.mock.mockImplementation(async () => undefined);
  await assert.rejects(page(), /not-found/);
  assert.equal(record.mock.callCount(), 0);
});
test("print denies record authorization failures", async () => {
  record.mock.mockImplementation(async () => { throw new Error("access revoked"); });
  await assert.rejects(page(), /not-found/);
  assert.equal(orderRead.mock.callCount(), 0);
});
test("preview rechecks order access after document preparation", async () => {
  const entry = await page();
  orderRead.mock.mockImplementation(async () => undefined);
  await assert.rejects(DocumentPreview(entry.props), /not-found/);
});

for (const type of ["order", "delivery", "invoiceDraft"] as const) {
  test(`print ${type} works before downloading, including unpersisted mock records`, async () => {
    const entry = await page(type);
    assert.equal(entry.type, DocumentPreview);
    assert.equal(entry.props.autoPrint, true);
    assert.equal(entry.props.document.type, type);
    assert.equal(entry.props.document.number, `DOC-1047-${type === "order" ? "O" : type === "delivery" ? "D" : "I"}`);
    if (type !== "order") assert.equal(documentById.has(entry.props.document.id), false);
    const document = new JSDOM(renderToStaticMarkup(await DocumentPreview(entry.props))).window.document;
    assert.equal(document.querySelector(".doc-sheet")?.getAttribute("lang"), "he");
    assert.ok(document.querySelector(".doc-sheet")?.textContent?.includes(products[0].translations.he.name));
    assert.ok(document.querySelector(".doc-sheet")?.textContent?.includes(entry.props.document.number));
    const t = getDictionary("he").docs;
    if (type === "invoiceDraft") {
      assert.ok(document.querySelector(".doc-sheet")?.textContent?.includes(t.draftWatermark));
      assert.ok(document.querySelector(".doc-sheet")?.textContent?.includes(t.notLegalNotice));
    }
    if (type === "delivery") {
      assert.ok(document.querySelector(".doc-sheet")?.textContent?.includes(t.signature));
      assert.ok(!document.querySelector(".doc-sheet")?.textContent?.includes(t.colUnitPrice));
      assert.ok(!document.querySelector(".doc-sheet")?.textContent?.includes(t.totalEstimate));
    }
  });
}

for (const locale of locales) {
  test(`${locale}: existing Preview preserves Hebrew-first document and does not auto-print`, async () => {
    const entry = await PreviewPage({ params: Promise.resolve({ locale, id: "doc-1047-o" }) });
    assert.equal(entry.props.autoPrint, undefined);
    const document = new JSDOM(renderToStaticMarkup(await DocumentPreview(entry.props))).window.document;
    assert.equal(document.querySelector(".doc-sheet")?.getAttribute("lang"), "he");
    assert.ok(document.body.textContent?.includes(getDictionary(locale).docs.printAction));
  });
}

test("auto-print waits for fonts, prints once even in StrictMode, and retains manual print", async () => {
  let fontsReady!: () => void;
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((resolve) => { fontsReady = resolve; }) } });
  const print = mock.method(window, "print", () => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const tree = await sheet("invoiceDraft");
    await act(async () => root.render(createElement(StrictMode, null, tree)));
    assert.equal(print.mock.callCount(), 0);
    await act(async () => fontsReady());
    assert.equal(print.mock.callCount(), 1);
    await act(async () => root.render(createElement(StrictMode, null, tree)));
    assert.equal(print.mock.callCount(), 1);
    const button = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes(getDictionary("en").docs.printAction))!;
    act(() => button.click());
    assert.equal(print.mock.callCount(), 2);
  } finally {
    act(() => root.unmount()); container.remove(); print.mock.restore();
    Reflect.deleteProperty(document, "fonts");
  }
});

test("leaving the preview before assets are ready cancels automatic print", async () => {
  let fontsReady!: () => void;
  Object.defineProperty(document, "fonts", { configurable: true, value: { ready: new Promise<void>((resolve) => { fontsReady = resolve; }) } });
  const print = mock.method(window, "print", () => undefined);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    const tree = await sheet("order");
    await act(async () => root.render(tree));
    act(() => root.unmount());
    await act(async () => fontsReady());
    assert.equal(print.mock.callCount(), 0);
  } finally {
    container.remove(); print.mock.restore(); Reflect.deleteProperty(document, "fonts");
  }
});
