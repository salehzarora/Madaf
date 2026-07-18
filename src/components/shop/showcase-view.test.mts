/**
 * PILOT-OPS-AUDIT-008-FIX2 — MOUNTED ShowcaseView token-order retry persistence.
 *
 * Mounts the REAL ShowcaseView (browse → checkout guest form) with the showcase
 * order action module-mocked to CAPTURE the submission key. Proves the same
 * persistence contract as the shop flow: the SAME key survives a refresh
 * (remount) and an ambiguous-failure retry; a confirmed success rotates it; a
 * different token gets a different key; storage-unavailable fails closed (no
 * action call); the key never renders and the raw token / guest details are
 * never persisted by the key helper.
 *
 * Runner: `npm run test:showcase-view` (needs --experimental-test-module-mocks).
 */
// FIRST: DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

// The checkout form builds `new FormData(event.currentTarget)`; jsdom's FormData
// supports the (form) constructor argument that Node's global (undici) FormData
// does not. Bridge it so the mounted submit path works.
(globalThis as unknown as { FormData: typeof dom.window.FormData }).FormData =
  dom.window.FormData;

import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import { getDictionary } from "@/i18n/dictionaries";
import type { ShowcaseCatalog } from "@/lib/data/catalog-showcase";
import { categories, manufacturers, products } from "@/lib/mock";

interface ActionCall {
  token: string;
  submissionKey: string;
}
const calls: ActionCall[] = [];
let actionImpl: (input: {
  token: string;
  submissionKey: string;
}) => Promise<{ ok: boolean; publicRef?: string; reason?: "conflict" }> = async () => ({
  ok: false,
});
mock.module("@/lib/actions/catalog-showcase", {
  namedExports: {
    submitShowcaseOrderAction: async (input: { token: string; submissionKey: string }) => {
      calls.push({ token: input.token, submissionKey: input.submissionKey });
      return actionImpl(input);
    },
  },
});
mock.module("next/navigation", {
  namedExports: {
    usePathname: () => "/en/showcase/token",
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

const { ShowcaseView } = await import("@/components/shop/showcase-view");

const dict = getDictionary("en");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = "showcasetoken-fixture-cccccccccc";
const TOKEN2 = "showcasetoken-fixture-dddddddddd";
const inStockProduct = { ...products[0], availability: "inStock" as const };

function catalog(): ShowcaseCatalog {
  return {
    tenantName: { ar: "متجر", he: "חנות", en: "Shop" },
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
    root.render(React.createElement(ShowcaseView, { locale: "en", dict, token, catalog: catalog() }));
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

/** Browse → add (if needed) → review (if on browse) → fill required name →
 * submit the form; resolve when the action is called or a prep error shows. */
async function guestSubmit(container: HTMLElement, storeName = "Test Store"): Promise<number> {
  const add = buttonByText(container, dict.catalog.addToCart);
  if (add) await click(add);
  const review = buttonByText(container, dict.access.showcase.reviewOrder);
  if (review) await click(review);
  const nameInput = container.querySelector('input[name="name"]') as HTMLInputElement | null;
  assert.ok(nameInput, "store-name input present on the checkout step");
  nameInput.value = storeName;
  const form = container.querySelector("form") as HTMLFormElement | null;
  assert.ok(form, "checkout form present");
  const submitBtn = buttonByText(container, dict.access.showcase.submit);
  const before = calls.length;
  // requestSubmit() is the spec path: it fires a real submit event so React's
  // onSubmit receives a proper event.currentTarget for its FormData.
  await act(async () => {
    form.requestSubmit(submitBtn ?? undefined);
  });
  await waitFor(
    () =>
      calls.length > before ||
      (container.textContent ?? "").includes(dict.access.showcase.prepError),
    "submit resolves",
  );
  return before;
}

test("first submit sends a persisted UUID key; a refresh (remount) sends the SAME key", async () => {
  const c1 = mount();
  await guestSubmit(c1);
  assert.equal(calls.length, 1);
  const key1 = calls[0].submissionKey;
  assert.match(key1, UUID);
  assert.equal(calls[0].token, TOKEN);

  unmountAll();
  const c2 = mount();
  await guestSubmit(c2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the remount reused the persisted key");
});

test("an ambiguous failure retains the key; the retry reuses it", async () => {
  actionImpl = async () => {
    throw new Error("network lost after commit");
  };
  const c = mount();
  await guestSubmit(c);
  const key1 = calls[0].submissionKey;
  await guestSubmit(c); // component stays on the checkout step after the error
  assert.equal(calls.length, 2);
  assert.equal(calls[1].submissionKey, key1, "the retry sent the same key");
});

test("a confirmed success clears the key; the next order gets a DIFFERENT key", async () => {
  actionImpl = async () => ({ ok: true, publicRef: "MDF-BBBBBBBB" });
  const c1 = mount();
  await guestSubmit(c1);
  const key1 = calls[0].submissionKey;
  unmountAll();
  actionImpl = async () => ({ ok: false });
  const c2 = mount();
  await guestSubmit(c2);
  assert.notEqual(calls[1].submissionKey, key1, "a new order after success gets a fresh key");
});

test("a different token gets a different key", async () => {
  const c1 = mount(TOKEN);
  await guestSubmit(c1);
  unmountAll();
  const c2 = mount(TOKEN2);
  await guestSubmit(c2);
  assert.notEqual(calls[1].submissionKey, calls[0].submissionKey);
});

test("storage unavailable → the order action is NOT called and a prep error shows", async () => {
  const realDesc = Object.getOwnPropertyDescriptor(dom.window, "sessionStorage")!;
  Object.defineProperty(dom.window, "sessionStorage", { value: undefined, configurable: true });
  try {
    const c = mount();
    await guestSubmit(c);
    assert.equal(calls.length, 0, "no order was submitted (fail closed)");
    assert.ok((c.textContent ?? "").includes(dict.access.showcase.prepError), "prep error shown");
  } finally {
    Object.defineProperty(dom.window, "sessionStorage", realDesc);
  }
});

test("the submission key never appears in the DOM, and the raw token is never persisted", async () => {
  const c = mount();
  await guestSubmit(c, "Guest Shop Ltd");
  const key = calls[0].submissionKey;
  assert.ok(!(dom.window.document.body.textContent ?? "").includes(key), "key not rendered");
  const ss = dom.window.sessionStorage;
  for (let i = 0; i < ss.length; i++) {
    const k = ss.key(i)!;
    assert.ok(!k.includes(TOKEN), "raw token not in a storage key");
    const v = ss.getItem(k) ?? "";
    assert.ok(!v.includes(TOKEN), "raw token not in a storage value");
    assert.ok(!v.includes("Guest Shop Ltd"), "guest PII not in a storage value");
  }
});
