import "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "@/i18n/dictionaries";
import { locales, type Locale } from "@/i18n/config";
import { DocumentQuickActions } from "./document-quick-actions";
import type { DocumentWindow } from "@/lib/client/native-documents";

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
  delete (window as DocumentWindow).MadafNative;
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

function nativeFixture(documents = { sharePdf: true, printPdf: true }, status = "opened") {
  const listeners = new Set<(event: { data: string }) => void>();
  const calls: { id: string; type: string; path?: string }[] = [];
  const bridge = {
    onmessage: mock.fn(),
    addEventListener: (_type: "message", fn: (event: { data: string }) => void) => { listeners.add(fn); },
    removeEventListener: (_type: "message", fn: (event: { data: string }) => void) => { listeners.delete(fn); },
    postMessage(raw: string) {
      const request = JSON.parse(raw); calls.push(request);
      const result = request.type === "getCapabilities"
        ? { version: 1, platform: "android", shell: "webview", documents, push: { configured: true } }
        : { status, details: "private native provider information" };
      queueMicrotask(() => listeners.forEach(fn => fn({ data: JSON.stringify({ id: request.id, type: request.type, result }) })));
    },
  };
  (window as DocumentWindow).MadafNative = bridge;
  return { bridge, calls, listeners };
}

test("native Share sends only relative PDF path and uses neither Web Share nor PDF fallback/fetch", async () => {
  const f = nativeFixture(); const pushHandler = f.bridge.onmessage;
  mount(); await click();
  assert.deepEqual(f.calls.map(call => call.type), ["getCapabilities", "shareDocumentPdf"]);
  assert.equal(f.calls[1].path, `${base}?mode=share`);
  assert.deepEqual(Object.keys(f.calls[1]).sort(), ["id", "path", "type"]);
  assert.equal(fetchMock.mock.callCount() + shareMock.mock.callCount() + openMock.mock.callCount(), 0);
  assert.equal(f.bridge.onmessage, pushHandler);
  assert.equal(container.querySelector("button")!.disabled, false);
});

test("native Print intercepts only its click, sends prepared PDF command and retains Download", async () => {
  const f = nativeFixture(); mount();
  const print = container.querySelector("a")!;
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => { print.dispatchEvent(event); });
  assert.equal(event.defaultPrevented, true);
  assert.equal(f.calls[1].type, "printDocumentPdf");
  assert.equal(f.calls[1].path, `${base}?mode=share`);
  assert.equal(openMock.mock.callCount() + fetchMock.mock.callCount(), 0);
  assert.equal(container.querySelectorAll("a")[1].getAttribute("href"), base);
});

test("legacy native capabilities preserve browser Share and Print fallback", async () => {
  const f = nativeFixture({ sharePdf: false, printPdf: false }); mount(); await click();
  assert.equal(shareMock.mock.callCount(), 1);
  await act(async () => { container.querySelector("a")!.click(); });
  assert.deepEqual(openMock.mock.calls[0].arguments, [`${base}/print`, "_blank", "noopener,noreferrer"]);
  assert.deepEqual(f.calls.map(call => call.type), ["getCapabilities"]);
});

test("native cancellation is silent and leaves all actions usable", async () => {
  nativeFixture(undefined, "cancelled"); mount(); await click();
  assert.equal(container.querySelector('[role="status"]')!.textContent, "");
  assert.equal(container.querySelector("button")!.disabled, false);
  assert.equal(openMock.mock.callCount(), 0);
});

for (const locale of locales) {
  test(`${locale}: native failure shows localized generic message without provider details`, async () => {
    nativeFixture(undefined, "error"); mount(locale); await click();
    assert.ok(container.textContent!.includes(getDictionary(locale).docs.quickActions.nativeError));
    assert.doesNotMatch(container.textContent!, /private native provider/);
    assert.equal(container.querySelector("button")!.disabled, false);
    assert.equal(shareMock.mock.callCount(), 0);
  });
}

test("native listener is removed on unmount without modifying push onmessage", async () => {
  const f = nativeFixture(); mount(); await click();
  const pushHandler = f.bridge.onmessage;
  assert.equal(f.listeners.size, 1);
  act(() => root.render(null));
  assert.equal(f.listeners.size, 0);
  assert.equal(f.bridge.onmessage, pushHandler);
});

test("uncorrelated native responses cannot trigger a document command", async () => {
  const f = nativeFixture();
  f.bridge.postMessage = raw => {
    const request = JSON.parse(raw); f.calls.push(request);
    f.listeners.forEach(fn => fn({ data: JSON.stringify({ id: "wrong-id", type: request.type,
      result: { version: 1, platform: "android", shell: "webview", documents: { sharePdf: true } } }) }));
  };
  mount();
  act(() => container.querySelector("button")!.click());
  assert.deepEqual(f.calls.map(call => call.type), ["getCapabilities"]);
  assert.equal(shareMock.mock.callCount(), 0);
  await act(async () => root.render(null));
});
