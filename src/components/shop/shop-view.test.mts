/**
 * PILOT-OPS-AUDIT-008-FIX2 — MOUNTED ShopView token-order retry persistence.
 *
 * Mounts the REAL ShopView with the server action module-mocked to CAPTURE the
 * submission key it sends. Proves the component now sources the key from the
 * PERSISTED sessionStorage helper (not volatile state): the SAME key is sent
 * across a remount (a refresh) and across an ambiguous-failure retry; a confirmed
 * success clears it (a new order gets a new key); a different token gets a
 * different key; and when browser storage is unavailable the order action is NOT
 * called (fail closed) — the key never appears in the DOM and the raw token is
 * never persisted.
 *
 * Runner: `npm run test:shop-view` (needs --experimental-test-module-mocks; plain
 * tsx so React keeps its client hooks).
 */
// FIRST: DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { getDictionary } from "@/i18n/dictionaries";
import type { TokenCatalog } from "@/lib/data/token";
import { categories, manufacturers, products } from "@/lib/mock";

// ── Capture the action's submission key; control its result per-test ──────────
interface ActionCall {
  token: string;
  submissionKey: string;
}
const calls: ActionCall[] = [];
let actionImpl: (input: {
  token: string;
  submissionKey: string;
}) => Promise<{ ok: boolean; publicRef?: string; reason?: "conflict" }> = async () => ({
  ok: false, // default: a plain failure that RETAINS the key
});
mock.module("@/lib/actions/shop", {
  namedExports: {
    submitShopOrderAction: async (input: { token: string; submissionKey: string }) => {
      calls.push({ token: input.token, submissionKey: input.submissionKey });
      return actionImpl(input);
    },
  },
});
// LocaleSwitcher reads usePathname(); provide a router-free stub for the mount.
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/en/shop/token",
    useRouter: () => ({
      push() {},
      replace() {},
      refresh() {},
      back() {},
      forward() {},
      prefetch() {},
    }),
    useSearchParams: () => new URLSearchParams(),
    useParams: () => ({}),
  },
});

const { ShopView } = await import("@/components/shop/shop-view");

const dict = getDictionary("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = "shoptoken-fixture-cccccccccccccccc";
const TOKEN2 = "shoptoken-fixture-dddddddddddddddd";
const inStockProduct = { ...products[0], availability: "inStock" as const };

function catalog(): TokenCatalog {
  return {
    tenantName: { ar: "متجر", he: "חנות", en: "Shop" },
    customer: { name: "Shop", city: { ar: "", he: "", en: "" } },
    products: [inStockProduct],
    categories,
    manufacturers,
  };
}

const mounted: { root: Root; container: HTMLElement }[] = [];
function mount(token = TOKEN): HTMLElement {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(React.createElement(ShopView, { locale: "en", dict, token, catalog: catalog() }));
  });
  return container;
}
function unmountAll(): void {
  for (const m of mounted.splice(0)) {
    act(() => m.root.unmount());
    m.container.remove();
  }
}

afterEach(() => {
  unmountAll();
  calls.length = 0;
  actionImpl = async () => ({ ok: false });
  dom.window.sessionStorage.clear();
});

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement | null {
  return (
    ([...container.querySelectorAll("button")] as HTMLButtonElement[]).find((b) =>
      (b.textContent ?? "").includes(text),
    ) ?? null
  );
}
async function click(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  });
}
async function waitFor(cond: () => boolean, label: string, tries = 40): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await act(async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
  }
  throw new Error(`waitFor timed out: ${label}`);
}

/** Add the one product to the cart, then click submit; resolve when the action is
 * called (or a preparation error is shown). Returns the count before submit. */
async function addAndSubmit(container: HTMLElement): Promise<number> {
  // Add the product only if it isn't already in the cart (a retry keeps the cart,
  // so the add button is replaced by the quantity stepper).
  const add = buttonByText(container, dict.catalog.addToCart);
  if (add) await click(add);
  const submit = buttonByText(container, dict.access.shop.submit);
  assert.ok(submit, "submit button present");
  const before = calls.length;
  await click(submit);
  await waitFor(
    () => calls.length > before || (container.textContent ?? "").includes(dict.access.shop.prepError),
    "submit resolves (action called or prep error shown)",
  );
  return before;
}

test("first submit sends a persisted UUID key; a refresh (remount) sends the SAME key", async () => {
  const c1 = mount();
  await addAndSubmit(c1);
  assert.equal(calls.length, 1);
  const key1 = calls[0].submissionKey;
  assert.match(key1, UUID);
  assert.equal(calls[0].token, TOKEN, "the raw token still flows to the action");

  // A refresh: unmount + remount (same token, same sessionStorage) → same key.
  unmountAll();
  const c2 = mount();
  await addAndSubmit(c2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the remount reused the persisted key (not volatile)");
});

test("an ambiguous failure retains the key; the retry reuses it", async () => {
  actionImpl = async () => {
    throw new Error("network lost after commit"); // ambiguous
  };
  const c = mount();
  await addAndSubmit(c);
  const key1 = calls[0].submissionKey;
  // Retry in the SAME mount (component stays mounted after the error).
  await addAndSubmit(c);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the retry sent the same key");
});

test("a confirmed success clears the key; the next order gets a DIFFERENT key", async () => {
  actionImpl = async () => ({ ok: true, publicRef: "MDF-AAAAAAAA" });
  const c1 = mount();
  await addAndSubmit(c1);
  const key1 = calls[0].submissionKey;
  // Success renders the terminal screen; a brand-new order (remount) must differ.
  unmountAll();
  actionImpl = async () => ({ ok: false });
  const c2 = mount();
  await addAndSubmit(c2);
  assert.notEqual(calls[1].submissionKey, key1, "a new logical order after success gets a fresh key");
});

test("a different token gets a different key", async () => {
  const c1 = mount(TOKEN);
  await addAndSubmit(c1);
  unmountAll();
  const c2 = mount(TOKEN2);
  await addAndSubmit(c2);
  assert.notEqual(calls[1].submissionKey, calls[0].submissionKey, "distinct token → distinct key");
});

test("storage unavailable → the order action is NOT called and a prep error shows", async () => {
  const realDesc = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage")!;
  Object.defineProperty(dom.window, "sessionStorage", { value: undefined, configurable: true });
  try {
    const c = mount();
    const add = buttonByText(c, dict.catalog.addToCart);
    await click(add!);
    const submit = buttonByText(c, dict.access.shop.submit);
    await click(submit!);
    await waitFor(() => (c.textContent ?? "").includes(dict.access.shop.prepError), "prep error shown");
    assert.equal(calls.length, 0, "no order was submitted (fail closed)");
  } finally {
    Object.defineProperty(dom.window, "sessionStorage", realDesc);
  }
});

test("the submission key never appears in the rendered DOM, and the raw token is never persisted", async () => {
  const c = mount();
  await addAndSubmit(c);
  const key = calls[0].submissionKey;
  assert.ok(!(dom.window.document.body.textContent ?? "").includes(key), "key not rendered anywhere");
  // Inspect every sessionStorage entry.
  const ss = dom.window.sessionStorage;
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)!;
    assert.ok(!k.includes(TOKEN), "raw token not in a storage key");
    assert.ok(!(ss.getItem(k) ?? "").includes(TOKEN), "raw token not in a storage value");
  }
});
