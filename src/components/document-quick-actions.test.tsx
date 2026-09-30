import "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { DocumentQuickActions } from "./document-quick-actions";

let container: HTMLDivElement;
let root: Root;
const labels = getDictionary("en").docs.quickActions;
const base = "/en/admin/orders/order-id/documents/order";
const pdf = () => new Response("%PDF-1.4\nfile", { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="DOC-123-O.pdf"' } });
const fetchMock = mock.fn<(url: unknown, options?: RequestInit) => Promise<Response>>(async () => pdf());
const shareMock = mock.fn<(data: ShareData) => Promise<void>>(async () => undefined);
const canShareMock = mock.fn<(data: ShareData) => boolean>(() => true);
const openMock = mock.fn<(url?: string | URL, target?: string, features?: string) => null>(() => null);

beforeEach(() => {
  for (const fn of [fetchMock, shareMock, canShareMock, openMock]) fn.mock.resetCalls();
  fetchMock.mock.mockImplementation(async () => pdf());
  shareMock.mock.mockImplementation(async () => undefined);
  canShareMock.mock.mockImplementation(() => true);
  Object.assign(navigator, { share: shareMock, canShare: canShareMock });
  mock.method(globalThis, "fetch", fetchMock);
  mock.method(window, "open", openMock);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  mock.restoreAll();
});
function mount(locale: Locale = "en") {
  act(() => root.render(<DocumentQuickActions locale={locale} orderId="order-id" type="order" labels={getDictionary(locale).docs.quickActions} />));
}
async function click() {
  await act(async () => { container.querySelector<HTMLButtonElement>("button")!.click(); });
}

for (const locale of locales) {
  test(`${locale}: Share, Print, Download order and correct same-origin destinations`, () => {
    mount(locale);
    const t = getDictionary(locale).docs.quickActions;
    assert.deepEqual(Array.from(container.querySelectorAll("button, a"), (node) => node.textContent), [t.share, t.print, t.download]);
    const links = container.querySelectorAll("a");
    assert.equal(links[0].getAttribute("href"), `/${locale}/admin/orders/order-id/documents/order/print`);
    assert.equal(links[0].target, "_blank");
    assert.equal(links[0].rel, "noopener noreferrer");
    assert.equal(links[1].getAttribute("href"), `/${locale}/admin/orders/order-id/documents/order`);
  });
}

test("Share fetches protected inline bytes, shares an actual PDF File and no URL", async () => {
  mount();
  await click();
  const fetchArgs = fetchMock.mock.calls[0].arguments;
  assert.equal(fetchArgs[0], `${base}?mode=share`);
  assert.equal(fetchArgs[1]?.credentials, "same-origin");
  assert.equal(fetchArgs[1]?.cache, "no-store");
  assert.equal(fetchArgs[1]?.redirect, "error");
  const payload = shareMock.mock.calls[0].arguments[0];
  assert.deepEqual(Object.keys(payload), ["files"]);
  const file = payload.files![0];
  assert.ok(file instanceof File);
  assert.equal(file.name, "DOC-123-O.pdf");
  assert.equal(file.type, "application/pdf");
  assert.equal(await file.text(), "%PDF-1.4\nfile");
  assert.deepEqual(canShareMock.mock.calls[0].arguments, [{ files: [file] }]);
  assert.equal(container.querySelector("button")!.disabled, false);
  assert.equal(openMock.mock.callCount(), 0);
});

test("without Web Share, open the inline PDF with popup-safe visible fallback link", async () => {
  Object.assign(navigator, { share: undefined });
  mount();
  await click();
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.deepEqual(openMock.mock.calls[0].arguments, [`${base}?mode=share`, "_blank", "noopener,noreferrer"]);
  assert.match(container.textContent!, new RegExp(labels.fallback));
  assert.equal(container.querySelector('[role="status"] a')?.getAttribute("href"), `${base}?mode=share`);
});

test("unsupported file sharing uses inline fallback instead of sharing an admin URL", async () => {
  canShareMock.mock.mockImplementation(() => false);
  mount();
  await click();
  assert.equal(shareMock.mock.callCount(), 0);
  assert.equal(openMock.mock.callCount(), 1);
});

test("canShare is optional when share supports files", async () => {
  Object.assign(navigator, { canShare: undefined });
  mount();
  await click();
  assert.equal(shareMock.mock.callCount(), 1);
});

test("AbortError settles loading silently without fallback/error", async () => {
  shareMock.mock.mockImplementation(async () => { throw new DOMException("cancelled", "AbortError"); });
  mount();
  await click();
  assert.equal(container.querySelector('[role="status"]')!.textContent, "");
  assert.equal(container.querySelector("button")!.disabled, false);
  assert.equal(openMock.mock.callCount(), 0);
});

test("activation lost during fetch allows a fresh tap with prepared File and no second fetch", async () => {
  shareMock.mock.mockImplementationOnce(async () => { throw new DOMException("activation", "NotAllowedError"); });
  mount();
  await click();
  assert.ok(container.textContent!.includes(labels.ready));
  await click();
  assert.equal(fetchMock.mock.callCount(), 1);
  assert.equal(shareMock.mock.callCount(), 2);
  assert.equal(container.querySelector('[role="status"]')!.textContent, "");
});

for (const response of [
  () => new Response("private details", { status: 403 }),
  () => new Response("<html>login</html>", { headers: { "Content-Type": "text/html" } }),
  () => new Response("", { headers: { "Content-Type": "application/pdf" } }),
]) {
  test("failed/non-PDF/empty fetch shows generic localized fallback and resets loading", async () => {
    fetchMock.mock.mockImplementation(async () => response());
    mount();
    await click();
    assert.ok(container.textContent!.includes(labels.error));
    assert.doesNotMatch(container.textContent!, /private details|<html>/);
    assert.equal(shareMock.mock.callCount(), 0);
    assert.equal(container.querySelector("button")!.disabled, false);
  });
}

test("native provider failure never exposes provider details", async () => {
  shareMock.mock.mockImplementation(async () => { throw new Error("secret provider details"); });
  mount();
  await click();
  assert.ok(container.textContent!.includes(labels.error));
  assert.doesNotMatch(container.textContent!, /secret provider/);
  assert.equal(container.querySelector("button")!.disabled, false);
});

test("pending fetch disables duplicate taps; unmount cancels the request", async () => {
  let signal: AbortSignal | undefined;
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    signal = options?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError"))));
  });
  mount();
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  assert.equal(container.querySelector("button")!.disabled, true);
  assert.equal(container.querySelector("button")!.getAttribute("aria-busy"), "true");
  await act(async () => root.render(null));
  assert.equal(signal?.aborted, true);
  assert.equal(shareMock.mock.callCount(), 0);
});

test("changing the document aborts the old request and never leaves the new action disabled", async () => {
  let oldSignal: AbortSignal | undefined;
  mock.restoreAll();
  mock.method(globalThis, "fetch", async (_url: unknown, options?: RequestInit) => {
    oldSignal = options?.signal as AbortSignal;
    return new Promise<Response>((_resolve, reject) => oldSignal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError"))));
  });
  mount();
  act(() => container.querySelector<HTMLButtonElement>("button")!.click());
  assert.equal(container.querySelector("button")!.disabled, true);
  await act(async () => root.render(<DocumentQuickActions locale="en" orderId="another-order" type="delivery" labels={labels} />));
  assert.equal(oldSignal?.aborted, true);
  assert.equal(container.querySelector("button")!.disabled, false);
  assert.equal(container.querySelector("a")!.getAttribute("href"), "/en/admin/orders/another-order/documents/delivery/print");
});
