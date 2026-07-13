/**
 * M8H.2 — MOUNTED MovementsTable INTEGRATION TESTS.
 *
 * The reducer was correct and the component still shipped three defects. Testing the
 * reducer alone proved the *transitions* were right while saying nothing about the
 * *integration* — which is where the bugs actually were:
 *
 *   1. Filter controls used separate `useState`s and a PASSIVE `useEffect`
 *      invalidated the session afterwards, so one committed render showed the NEW
 *      filters beside the OLD rows, the OLD `hasMore` and an ENABLED Export.
 *   2. Rows and the CSV were formatted with the page's bootstrap `timeZone` prop
 *      rather than the zone the SERVER resolved the current session under — so after
 *      a cross-tab zone change, a UTC session's rows were printed in Jerusalem time.
 *   3. A stale session showed an explanation and nothing to press; a failed one showed
 *      nothing at all. Re-selecting the already-selected filter fires no change event,
 *      so the operator was stuck.
 *
 * So these mount the REAL component (no copy, no re-implementation), with the Server
 * Actions supplied through the production injection seam and resolved by hand, so
 * intermediate renders can be observed.
 *
 * Runner: `npm run test:movements-table` (plain tsx — NOT --conditions=react-server,
 * which would resolve React to its server build and give us no hooks).
 */
// FIRST: the DOM globals must exist before react-dom/client is evaluated.
import { dom } from "@/test-support/jsdom-env";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

import { MovementsTable } from "@/components/admin/movements-table";
import { getDictionary } from "@/i18n/dictionaries";
import { formatTenantDateTime } from "@/lib/time";
import type { InventoryMovement, Order, Product } from "@/lib/types";
import type {
  MovementExportResult,
  MovementSearchInput,
  MovementSearchResult,
} from "@/lib/actions/inventory";

const JLM = "Asia/Jerusalem";
const UTC = "UTC";
/** The reference instant: 09:57Z is 12:57 in Jerusalem (+03) and 09:57 in UTC. */
const INSTANT = "2026-07-13T09:57:17.908Z";

// ── Fixtures ──────────────────────────────────────────────────────────────
const product: Product = {
  id: "p1",
  sku: "SKU-1",
  translations: {
    ar: { name: "منتج" },
    he: { name: "מוצר" },
    en: { name: "Widget" },
  },
  categoryId: "c1",
  manufacturerId: "m1",
  packageType: "carton",
  unitsPerPackage: 12,
  baseUnit: "units",
  wholesalePrice: 10,
  availability: "inStock",
  vatRate: 18,
  isActive: true,
};

const movement = (id: string, createdAt = INSTANT): InventoryMovement => ({
  id,
  productId: "p1",
  orderId: null,
  quantityDelta: -1,
  reason: "manual_correction",
  createdAt,
  note: undefined,
});

const orders: Order[] = [];

/** A promise whose resolution the test controls — so intermediate renders exist. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

interface Harness {
  container: HTMLElement;
  /** Every search request the component made, in order. */
  searches: MovementSearchInput[];
  exports: MovementSearchInput[];
  /** Resolve the Nth search request (0-based). */
  answerSearch: (i: number, r: MovementSearchResult) => Promise<void>;
  answerExport: (i: number, r: MovementExportResult) => Promise<void>;
  csv: { filename: string; body: string }[];
  /** Resolve every still-pending request, then unmount. An in-flight `useTransition`
   * left dangling on an unmounted root keeps React's act queue busy and corrupts the
   * NEXT test — so a test never leaks a promise it did not answer. */
  teardown: () => Promise<void>;
}

let harnesses: Harness[] = [];

function mount(opts: {
  initial?: InventoryMovement[];
  timeZone?: string;
  locale?: "ar" | "he" | "en";
}): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);

  const searches: MovementSearchInput[] = [];
  const exports: MovementSearchInput[] = [];
  const searchDeferreds: ReturnType<typeof deferred<MovementSearchResult>>[] = [];
  const exportDeferreds: ReturnType<typeof deferred<MovementExportResult>>[] = [];
  const csv: { filename: string; body: string }[] = [];

  const searchAction = (input: MovementSearchInput) => {
    searches.push(input);
    const d = deferred<MovementSearchResult>();
    searchDeferreds.push(d);
    return d.promise;
  };
  const exportAction = (input: MovementSearchInput) => {
    exports.push(input);
    const d = deferred<MovementExportResult>();
    exportDeferreds.push(d);
    return d.promise;
  };

  const locale = opts.locale ?? "en";
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(MovementsTable, {
        movements: opts.initial ?? [],
        products: [product],
        orders,
        canExport: true,
        locale,
        dict: getDictionary(locale),
        timeZone: opts.timeZone ?? JLM,
        searchAction,
        exportAction,
        download: (filename: string, body: string) => csv.push({ filename, body }),
      }),
    );
  });

  const h: Harness = {
    container: container as unknown as HTMLElement,
    searches,
    exports,
    csv,
    async answerSearch(i, r) {
      await act(async () => {
        searchDeferreds[i].resolve(r);
        await searchDeferreds[i].promise;
      });
    },
    async answerExport(i, r) {
      await act(async () => {
        exportDeferreds[i].resolve(r);
        await exportDeferreds[i].promise;
      });
    },
    async teardown() {
      await act(async () => {
        for (const d of searchDeferreds) d.resolve({ ok: false, error: "failed" });
        for (const d of exportDeferreds) d.resolve({ ok: false, error: "failed" });
      });
      act(() => root.unmount());
      container.remove();
    },
  };
  harnesses.push(h);
  return h;
}

// ── DOM queries ───────────────────────────────────────────────────────────
const $ = (h: Harness, sel: string) => h.container.querySelector(sel);
const $$ = (h: Harness, sel: string) => [...h.container.querySelectorAll(sel)];
const text = (h: Harness) => h.container.textContent ?? "";
const rowCells = (h: Harness) =>
  $$(h, "tbody tr td:first-child").map((td) => td.textContent?.trim() ?? "");
const button = (h: Harness, label: string) =>
  $$(h, "button").find((b) => (b.textContent ?? "").includes(label)) as
    | HTMLButtonElement
    | undefined;
const exportButton = (h: Harness) => button(h, "Export");
const loadMoreButton = (h: Harness) => button(h, "Load more");

function click(el: Element) {
  act(() => {
    (el as HTMLButtonElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
}

/** Change a <select> the way React sees it. */
function selectOption(el: Element, value: string) {
  act(() => {
    const node = el as HTMLSelectElement;
    const setter = Object.getOwnPropertyDescriptor(
      dom.window.HTMLSelectElement.prototype,
      "value",
    )!.set!;
    setter.call(node, value);
    node.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
}

const presetSelect = (h: Harness) => $$(h, "select")[1]; // [0] = reason, [1] = date
const searchInput = (h: Harness) => $(h, 'input[type="search"]') as HTMLInputElement;

/** Type into the search box the way React sees it (a discrete `input` event). */
function typeSearch(h: Harness, value: string) {
  act(() => {
    const node = searchInput(h);
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

/** Type WITHOUT act(), and read the DOM in the same synchronous turn — the only way
 * to prove the invalidation is not merely being flushed for us by `act`. */
function typeSearchAndReadDom<T>(h: Harness, value: string, read: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    const node = searchInput(h);
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLInputElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    return read(); // ← BEFORE any effect, and long before the 300ms debounce
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

/** Re-enter the act world after an un-acted dispatch, so React's queued work is
 * flushed here rather than leaking into the next test. */
async function settle() {
  await act(async () => {});
}

/** Advance past the search debounce so the (already-invalidated) request dials. */
async function flushDebounce() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 350));
  });
}

/**
 * Focus a control the way a keyboard user reaches it, and assert it actually took
 * focus (i.e. it is in the tab order — a `<div onClick>` would not be).
 */
function focusIt(el: Element): boolean {
  act(() => (el as HTMLButtonElement).focus());
  return dom.window.document.activeElement === el;
}

/**
 * Activate a focused control by KEYBOARD. jsdom does not implement a button's
 * Enter-to-activate behaviour, so this fires the activation event the browser would
 * synthesize — which is the same handler path, on an element we have just proven is
 * keyboard-focusable.
 */
function pressEnter(el: Element) {
  act(() => {
    el.dispatchEvent(
      new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
    (el as HTMLButtonElement).dispatchEvent(
      new dom.window.MouseEvent("click", { bubbles: true }),
    );
  });
}

/** A well-formed SUCCESS. `resolvedTimeZone` is REQUIRED by the type — that is the
 * C2 contract — so a success can no longer omit the zone it was resolved under. */
type MovementOk = Extract<MovementSearchResult, { ok: true }>;
const ok = (
  rows: InventoryMovement[],
  over: Partial<Omit<MovementOk, "ok">> = {},
): MovementSearchResult => ({
  ok: true,
  movements: rows,
  hasMore: false,
  resolvedFrom: "2026-07-13",
  resolvedTo: "2026-07-13",
  resolvedTimeZone: JLM,
  ...over,
});

/** A well-formed EXPORT success — which must ALSO name the zone it ran under, so the
 * client can verify the file it is about to write belongs to the session on screen. */
type ExportOk = Extract<MovementExportResult, { ok: true }>;
const okExport = (
  rows: InventoryMovement[],
  over: Partial<Omit<ExportOk, "ok">> = {},
): MovementExportResult => ({
  ok: true,
  movements: rows,
  capped: false,
  resolvedTimeZone: JLM,
  ...over,
});

afterEach(async () => {
  for (const h of harnesses) await h.teardown();
  harnesses = [];
});

/**
 * Fire a DISCRETE event WITHOUT `act()`, then read the DOM before the microtask
 * queue drains — the only way to make the atomicity claim falsifiable.
 *
 * `act()` flushes passive effects, so an assertion after it looks identical whether
 * the session was invalidated in the HANDLER (correct) or one tick later in a
 * PASSIVE EFFECT (the defect that shipped). React 19 renders a discrete event's state
 * update SYNCHRONOUSLY before the dispatch returns, but defers passive effects. So:
 *
 *   correct code → the reducer already ran → the DOM read here shows NO old rows
 *   old code     → only the control's useState ran → the DOM still shows old rows,
 *                  old hasMore, and an ENABLED Export beside the NEW filter value
 */
function fireDiscreteAndReadDom<T>(el: Element, value: string, read: () => T): T {
  const g = globalThis as unknown as Record<string, unknown>;
  const prev = g.IS_REACT_ACT_ENVIRONMENT;
  g.IS_REACT_ACT_ENVIRONMENT = false; // this dispatch is deliberately un-acted
  try {
    const node = el as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(
      dom.window.HTMLSelectElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    return read(); // ← BEFORE any passive effect could have run
  } finally {
    g.IS_REACT_ACT_ENVIRONMENT = prev;
  }
}

// ══════════════════════════════════════════════════════════════════════════
describe("DEFECT 1 — a filter change and session invalidation are ONE transition", () => {
  it("the render committed BY THE EVENT ITSELF already has no old session", async () => {
    const h = mount({ initial: [movement("a"), movement("b")] });
    assert.equal(rowCells(h).length, 2, "the SSR session is on screen");
    assert.equal(exportButton(h)?.disabled, false, "…and Export works");

    // Read the DOM in the SAME synchronous turn as the change event — before React
    // has had any chance to run a passive effect.
    const snapshot = fireDiscreteAndReadDom(presetSelect(h), "today", () => ({
      preset: (presetSelect(h) as HTMLSelectElement).value,
      rows: rowCells(h).length,
      exportDisabled: exportButton(h)?.disabled ?? true,
      loadMore: loadMoreButton(h) !== undefined,
    }));

    // THE INVARIANT. The control already shows the new value, and the old session is
    // ALREADY gone — in the very render the event committed. A passive-effect
    // invalidation fails every line below.
    assert.equal(snapshot.preset, "today", "the control shows the new value…");
    assert.equal(snapshot.rows, 0, "…and the old rows are ALREADY gone");
    assert.equal(
      snapshot.exportDisabled,
      true,
      "Export cannot be offered for a session that no longer matches the filter",
    );
    assert.equal(snapshot.loadMore, false, "…nor Load more");

    // Let the (already-issued) request settle so the harness unmounts cleanly.
    await act(async () => {});
    assert.equal(h.searches.length, 1);
    await h.answerSearch(0, ok([movement("c")]));
    assert.equal(rowCells(h).length, 1);
  });
});

describe("DEFECT 1 — the resulting session behaviour", () => {
  it("the very next committed render has no old rows, no Load more, no Export", async () => {
    const h = mount({ initial: [movement("a"), movement("b")] });
    // A resolved SSR session: rows visible, Export enabled.
    assert.equal(rowCells(h).length, 2, "the SSR'd rows are on screen");
    assert.equal(exportButton(h)?.disabled, false, "…and Export works");

    // Change the date preset. The request has NOT resolved yet.
    selectOption(presetSelect(h), "today");

    // THE ASSERTION THIS SUITE EXISTS FOR: in the committed render right after the
    // event, the new filter is selected and the old session is COMPLETELY gone.
    assert.equal(
      (presetSelect(h) as HTMLSelectElement).value,
      "today",
      "the control shows the new value…",
    );
    assert.deepEqual(rowCells(h), [], "…and the old rows are ALREADY gone");
    assert.equal(loadMoreButton(h), undefined, "no Load more for a dead session");
    assert.equal(
      exportButton(h)?.disabled,
      true,
      "Export is DISABLED — it cannot pair new filters with old rows",
    );
    assert.equal(h.searches.length, 1, "exactly one request was issued");
    assert.equal(h.searches[0].offset, 0, "…from offset zero");
    assert.equal(h.searches[0].preset, "today");
    assert.equal(h.searches[0].dateFrom, undefined, "no anchors carried over");
    assert.equal(h.searches[0].expectedTimeZone, undefined, "no tz binding carried over");

    // Resolving restores a working session.
    await h.answerSearch(0, ok([movement("c")]));
    assert.equal(rowCells(h).length, 1);
    assert.equal(exportButton(h)?.disabled, false);
  });

  it("a superseded response cannot restore rows or re-enable Export", async () => {
    const h = mount({ initial: [movement("a")] });
    selectOption(presetSelect(h), "today"); // request #0
    selectOption(presetSelect(h), "7d"); // request #1 supersedes it
    assert.equal(h.searches.length, 2);

    // The OLD request answers LAST, with rows and hasMore.
    await h.answerSearch(0, ok([movement("stale")], { hasMore: true }));
    assert.deepEqual(rowCells(h), [], "the superseded reply may not restore rows");
    assert.equal(loadMoreButton(h), undefined, "…nor hasMore");
    assert.equal(exportButton(h)?.disabled, true, "…nor Export-readiness");

    // The CURRENT request answers and takes effect.
    await h.answerSearch(1, ok([movement("fresh")]));
    assert.equal(rowCells(h).length, 1);
    assert.equal(exportButton(h)?.disabled, false);
  });

  it("rapid double filter changes: only the latest response may render", async () => {
    const h = mount({ initial: [movement("a")] });
    selectOption(presetSelect(h), "today");
    selectOption(presetSelect(h), "month");
    selectOption(presetSelect(h), "7d");
    assert.equal(h.searches.length, 3);
    assert.deepEqual(rowCells(h), [], "nothing shows while resolving");

    await h.answerSearch(1, ok([movement("mid")])); // a middle one
    assert.deepEqual(rowCells(h), [], "an intermediate reply is ignored");
    await h.answerSearch(0, ok([movement("first")])); // the oldest
    assert.deepEqual(rowCells(h), [], "…so is the oldest");
    await h.answerSearch(2, ok([movement("last")])); // the newest
    assert.equal(rowCells(h).length, 1, "only the latest renders");
    assert.equal((presetSelect(h) as HTMLSelectElement).value, "7d");
  });

  it("an OLD failure cannot kill a NEWER session", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today"); // #0
    selectOption(presetSelect(h), "7d"); // #1
    await h.answerSearch(1, ok([movement("live")]));
    assert.equal(rowCells(h).length, 1);

    await h.answerSearch(0, { ok: false, error: "failed" });
    assert.equal(rowCells(h).length, 1, "the live session survives the stale failure");
    assert.equal(exportButton(h)?.disabled, false);
    assert.ok(!text(h).includes("Could not load"), "no error for a dead generation");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("DEFECT 2 — rows and CSV use the RESOLVED SESSION's timezone", () => {
  it("a session resolved under UTC renders UTC — not the Asia/Jerusalem page prop", async () => {
    // The page was rendered when the tenant was in Jerusalem…
    const h = mount({ initial: [], timeZone: JLM });
    assert.equal(formatTenantDateTime(INSTANT, "en", JLM).includes("12:57"), true);

    // …and the server resolves this session under UTC (the zone was changed).
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { resolvedTimeZone: UTC }));

    const cell = rowCells(h)[0];
    assert.ok(cell.includes("09:57"), `the UTC wall clock — got ${cell}`);
    assert.ok(
      !cell.includes("12:57"),
      "the OLD Jerusalem interpretation must NOT be printed over the new session's rows",
    );
  });

  it("the CSV uses the same session timezone as the rows (never the page prop)", async () => {
    const h = mount({ initial: [], timeZone: JLM });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { resolvedTimeZone: UTC }));

    click(exportButton(h)!);
    await h.answerExport(0, okExport([movement("a")], { resolvedTimeZone: UTC }));

    assert.equal(h.csv.length, 1, "a file was produced");
    const body = h.csv[0].body;
    assert.ok(body.includes("09:57"), "the CSV carries the SESSION's UTC wall clock");
    assert.ok(!body.includes("12:57"), "…not the page prop's Jerusalem one");
    // Screen and file agree, which is the whole point.
    assert.ok(body.includes(rowCells(h)[0]), "CSV cell === screen cell");
  });

  it("the initial SSR session legitimately uses the page prop (it IS its zone)", async () => {
    const h = mount({ initial: [movement("a")], timeZone: JLM });
    assert.ok(rowCells(h)[0].includes("12:57"), "bootstrap rows use the bootstrap zone");
  });

  it("locale changes the language, not the session timezone", async () => {
    const he = mount({ initial: [], timeZone: JLM, locale: "he" });
    selectOption(presetSelect(he), "today");
    await he.answerSearch(0, ok([movement("a")], { resolvedTimeZone: UTC }));
    const cell = rowCells(he)[0];
    assert.ok(cell.includes("09:57"), "still the session's UTC clock under he");
    assert.ok(!cell.includes("12:57"));
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("DEFECT 3 — failed and stale sessions are RECOVERABLE", () => {
  it("timezone_changed clears the rows, disables everything, and offers Re-apply", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { hasMore: true }));
    assert.equal(rowCells(h).length, 1);
    assert.equal(loadMoreButton(h)?.disabled, false);

    // The owner changes the tenant timezone in another tab; the next page refuses.
    click(loadMoreButton(h)!);
    await h.answerSearch(1, { ok: false, error: "timezone_changed" });

    assert.deepEqual(rowCells(h), [], "no stale row may remain under EITHER zone");
    assert.equal(loadMoreButton(h), undefined, "Load more gone");
    assert.equal(exportButton(h)?.disabled, true, "Export disabled");
    assert.ok(text(h).includes("business timezone changed"), "localized explanation");
    const reapply = button(h, "Re-apply filter");
    assert.ok(reapply, "an ACTIONABLE recovery control exists");
    assert.equal(reapply!.tagName, "BUTTON", "a real, keyboard-reachable button");
    assert.equal(reapply!.getAttribute("type"), "button");
    assert.ok(!reapply!.disabled);
    assert.ok($(h, '[role="alert"]'), "announced to screen readers");
  });

  it("Re-apply starts a FRESH session: offset 0, same filters, no old anchors/zone", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { hasMore: true }));
    click(loadMoreButton(h)!);
    await h.answerSearch(1, { ok: false, error: "timezone_changed" });

    click(button(h, "Re-apply filter")!);
    assert.equal(h.searches.length, 3, "a new request was issued");
    const req = h.searches[2];
    assert.equal(req.offset, 0, "from offset ZERO");
    assert.equal(req.preset, "today", "the SAME selected filters");
    assert.equal(req.dateFrom, undefined, "no OLD anchors reused");
    assert.equal(req.dateTo, undefined);
    assert.equal(req.expectedTimeZone, undefined, "no OLD timezone binding reused");
    assert.equal(exportButton(h)?.disabled, true, "still nothing to export");

    // The server resolves it under the NEW authoritative zone.
    await h.answerSearch(2, ok([movement("b")], { resolvedTimeZone: UTC }));
    assert.equal(rowCells(h).length, 1);
    assert.ok(rowCells(h)[0].includes("09:57"), "rows render in the NEW session zone");
    assert.equal(exportButton(h)?.disabled, false, "Export re-enabled only after success");
    assert.ok(!text(h).includes("business timezone changed"), "the alert is gone");
  });

  it("a failed initial resolution offers Retry — which restarts from offset zero", async () => {
    const h = mount({ initial: [movement("a")] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, { ok: false, error: "failed" });

    assert.deepEqual(rowCells(h), [], "no stale rows are exposed by a failure");
    assert.equal(exportButton(h)?.disabled, true, "nothing resolved → nothing to export");
    assert.equal(loadMoreButton(h), undefined);
    assert.ok(text(h).includes("Could not load"), "a localized error");
    const retry = button(h, "Retry");
    assert.ok(retry, "an ACTIONABLE retry exists");
    assert.equal(retry!.tagName, "BUTTON");

    click(retry!);
    assert.equal(h.searches.length, 2);
    assert.equal(h.searches[1].offset, 0, "offset zero");
    assert.equal(h.searches[1].preset, "today", "the current selected filters");
    assert.equal(exportButton(h)?.disabled, true, "Export stays disabled until success");

    await h.answerSearch(1, ok([movement("b")]));
    assert.equal(rowCells(h).length, 1, "success restores the session");
    assert.equal(exportButton(h)?.disabled, false);
    assert.ok(!text(h).includes("Could not load"));
  });

  it("Retry pressed twice cannot mix generations", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, { ok: false, error: "failed" });

    click(button(h, "Retry")!); // request #1
    // The button is disabled while in flight, so drive a second restart by
    // re-triggering the same production handler through a second failure + retry.
    await h.answerSearch(1, { ok: false, error: "failed" });
    click(button(h, "Retry")!); // request #2
    assert.equal(h.searches.length, 3);

    // The FIRST retry answers last — it must not resurrect anything.
    await h.answerSearch(1, ok([movement("ghost")]));
    assert.deepEqual(rowCells(h), [], "the superseded retry is ignored");
    await h.answerSearch(2, ok([movement("real")]));
    assert.equal(rowCells(h).length, 1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("Export gating and RTL", () => {
  it("Export is unavailable during resolution and after a stale response", async () => {
    const h = mount({ initial: [movement("a")] });
    assert.equal(exportButton(h)?.disabled, false);

    selectOption(presetSelect(h), "today");
    assert.equal(exportButton(h)?.disabled, true, "…while resolving");
    click(exportButton(h)!); // a disabled button must not fire
    assert.equal(h.exports.length, 0, "no export request was made");

    await h.answerSearch(0, ok([movement("b")]));
    assert.equal(exportButton(h)?.disabled, false);

    click(exportButton(h)!);
    await h.answerExport(0, { ok: false, error: "timezone_changed" });
    assert.equal(h.csv.length, 0, "a stale export produces NO file");
    assert.deepEqual(rowCells(h), [], "…and invalidates the session");
    assert.equal(exportButton(h)?.disabled, true);
    assert.ok(button(h, "Re-apply filter"), "recovery is offered");
  });

  it("the export request carries the session's own snapshot, anchors and zone", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")]));

    click(exportButton(h)!);
    const req = h.exports[0];
    assert.equal(req.offset, 0);
    assert.equal(req.dateFrom, "2026-07-13", "the session's CLOSED anchors");
    assert.equal(req.dateTo, "2026-07-13");
    assert.equal(req.expectedTimeZone, JLM, "…and its timezone binding");
    assert.equal(req.preset, "today");
    await h.answerExport(0, okExport([movement("a")]));
  });

  it("Arabic renders a bidi-safe timestamp with Western digits", async () => {
    const ar = mount({ initial: [], timeZone: JLM, locale: "ar" });
    selectOption(presetSelect(ar), "today");
    await ar.answerSearch(0, ok([movement("a")]));
    const cell = rowCells(ar)[0];
    assert.ok(/\d/.test(cell), "Western digits (the ar locale pins them)");
    assert.ok(cell.includes("12:57"), "the tenant wall clock, in Arabic");
    // The recovery control is translated, not left in English.
    await ar.answerSearch(0, ok([movement("a")])); // no-op; session already resolved
    const arDict = getDictionary("ar");
    assert.notEqual(
      arDict.admin.inventory.movements.retry,
      getDictionary("en").admin.inventory.movements.retry,
      "Retry is translated",
    );
    assert.notEqual(
      arDict.admin.inventory.movements.reapplyFilter,
      getDictionary("en").admin.inventory.movements.reapplyFilter,
    );
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
describe("C1 — the product SEARCH invalidates synchronously; only the request waits", () => {
  it("the render committed BY THE KEYSTROKE already has no old session", async () => {
    const h = mount({ initial: [movement("a"), movement("b")] });
    assert.equal(rowCells(h).length, 2);
    assert.equal(exportButton(h)?.disabled, false);

    // Read the DOM in the SAME synchronous turn as the input event — 300ms before the
    // debounce could possibly fire. The search box was the last control that let the
    // OLD rows and an ENABLED Export sit under the NEW text for a third of a second.
    const snap = typeSearchAndReadDom(h, "Widget", () => ({
      value: searchInput(h).value,
      rows: rowCells(h).length,
      exportDisabled: exportButton(h)?.disabled ?? true,
      loadMore: loadMoreButton(h) !== undefined,
      pending: (h.container.querySelector('[role="status"]')?.textContent ?? "").length > 0,
      requests: h.searches.length,
    }));

    assert.equal(snap.value, "Widget", "the input shows the new text…");
    assert.equal(snap.rows, 0, "…and the old rows are ALREADY gone");
    assert.equal(snap.exportDisabled, true, "Export disabled IMMEDIATELY");
    assert.equal(snap.loadMore, false, "Load more unavailable IMMEDIATELY");
    assert.equal(snap.pending, true, "a pending/debouncing state is visible");
    assert.equal(snap.requests, 0, "…but NO request has been made yet (debounced)");

    // Only the REQUEST was deferred.
    await settle();
    await flushDebounce();
    assert.equal(h.searches.length, 1, "exactly one request, for the latest query");
    assert.deepEqual(h.searches[0].productIds, ["p1"], "…carrying the matched ids");
    await h.answerSearch(0, ok([movement("c")]));
    assert.equal(rowCells(h).length, 1);
    assert.equal(exportButton(h)?.disabled, false);
  });

  it("rapid typing issues ONE request, for the final query", async () => {
    const h = mount({ initial: [movement("a")] });
    typeSearch(h, "W");
    typeSearch(h, "Wi");
    typeSearch(h, "Widget");
    assert.equal(h.searches.length, 0, "no request while the operator is still typing");
    assert.deepEqual(rowCells(h), [], "…and the old session is dead throughout");

    await flushDebounce();
    assert.equal(h.searches.length, 1, "earlier timers were cancelled");
    assert.deepEqual(h.searches[0].productIds, ["p1"]);
  });

  it("Export and Load more cannot run while the search debounce is pending", async () => {
    const h = mount({ initial: [movement("a")] });
    // Drive a real resolved session first (the SSR one issues no request).
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { hasMore: true }));
    assert.equal(exportButton(h)?.disabled, false);
    assert.equal(loadMoreButton(h)?.disabled, false);

    typeSearch(h, "Widget"); // debouncing now
    assert.equal(exportButton(h)?.disabled, true);
    assert.equal(loadMoreButton(h), undefined);

    click(exportButton(h)!);
    assert.equal(h.exports.length, 0, "Export cannot run during the debounce");
    await flushDebounce();
    assert.equal(h.searches.length, 2, "only the search request went out");
  });

  it("an OLD search response cannot restore rows or Export; an OLD failure cannot kill the new session", async () => {
    const h = mount({ initial: [] });
    typeSearch(h, "Widget");
    await flushDebounce(); // request #0 for "Widget"
    typeSearch(h, "Gadget");
    await flushDebounce(); // request #1 for "Gadget"
    assert.equal(h.searches.length, 2);

    // The OLD request answers last, with rows.
    await h.answerSearch(0, ok([movement("stale")], { hasMore: true }));
    assert.deepEqual(rowCells(h), [], "a superseded search reply may not restore rows");
    assert.equal(exportButton(h)?.disabled, true);

    // The CURRENT one resolves.
    await h.answerSearch(1, ok([movement("fresh")]));
    assert.equal(rowCells(h).length, 1);
    assert.equal(exportButton(h)?.disabled, false);

    // …and a late FAILURE for the dead generation cannot kill it.
    await h.answerSearch(0, { ok: false, error: "failed" });
    assert.equal(rowCells(h).length, 1, "the live session survives");
    assert.ok(!text(h).includes("Could not load"));
  });

  it("clearing the search invalidates synchronously too", async () => {
    const h = mount({ initial: [] });
    typeSearch(h, "Widget");
    await flushDebounce();
    await h.answerSearch(0, ok([movement("a")]));
    assert.equal(rowCells(h).length, 1);

    const snap = typeSearchAndReadDom(h, "", () => ({
      rows: rowCells(h).length,
      exportDisabled: exportButton(h)?.disabled ?? true,
    }));
    assert.equal(snap.rows, 0, "clearing is a filter change like any other");
    assert.equal(snap.exportDisabled, true);

    await settle();
    await flushDebounce();
    assert.equal(h.searches[1].productIds, undefined, "no product filter");
  });

  it("a NO-OP search (same applied term) keeps the session and burns no generation", async () => {
    const h = mount({ initial: [] });
    typeSearch(h, "Widget");
    await flushDebounce();
    await h.answerSearch(0, ok([movement("a")], { hasMore: true }));
    assert.equal(rowCells(h).length, 1);
    assert.equal(exportButton(h)?.disabled, false);

    // Retyping the SAME term (only whitespace differs) changes no applied filter.
    typeSearch(h, "Widget ");
    assert.equal(rowCells(h).length, 1, "a healthy session is NOT torn down");
    assert.equal(exportButton(h)?.disabled, false, "…and Export stays available");
    await flushDebounce();
    assert.equal(h.searches.length, 1, "no request — nothing changed");

    // …and the session generation is still coherent: load-more still pages it.
    click(loadMoreButton(h)!);
    assert.equal(h.searches.length, 2);
    assert.equal(h.searches[1].offset, 1, "offset from the SAME session's rows");
    await h.answerSearch(1, ok([movement("b")]));
    assert.equal(rowCells(h).length, 2, "the page appended to the SAME session");
  });
});

// ══════════════════════════════════════════════════════════════════════════
describe("C2 — a SUCCESS must name the timezone it was resolved under", () => {
  it("a malformed success (no resolvedTimeZone) FAILS CLOSED — no rows, no fallback", async () => {
    const h = mount({ initial: [movement("a")], timeZone: JLM });
    selectOption(presetSelect(h), "today");

    // A type-valid-looking success that omits the zone. The cast is the point: this
    // reply crossed the network, and TypeScript is not a runtime trust boundary.
    const malformed = {
      ok: true,
      movements: [movement("x")],
      hasMore: false,
      resolvedFrom: "2026-07-13",
      resolvedTo: "2026-07-13",
    } as unknown as MovementSearchResult;
    await h.answerSearch(0, malformed);

    assert.deepEqual(rowCells(h), [], "the rows are NOT displayed");
    assert.ok(
      !text(h).includes("12:57"),
      "and above all NOT rendered under the page's Jerusalem prop",
    );
    assert.equal(exportButton(h)?.disabled, true, "Export stays disabled");
    assert.equal(loadMoreButton(h), undefined, "Load more stays unavailable");
    assert.ok(text(h).includes("Could not load"), "a failed state, with an explanation");
    const retry = button(h, "Retry");
    assert.ok(retry, "…and a Retry");

    // A subsequent VALID reply under UTC succeeds and binds the session to UTC.
    click(retry!);
    await h.answerSearch(1, ok([movement("a")], { resolvedTimeZone: UTC }));
    assert.equal(rowCells(h).length, 1);
    assert.ok(rowCells(h)[0].includes("09:57"), "rendered in the SESSION's zone");
    assert.ok(!rowCells(h)[0].includes("12:57"));
    assert.equal(exportButton(h)?.disabled, false);
  });

  it("an empty-string timezone is also refused (not just a missing key)", async () => {
    const h = mount({ initial: [], timeZone: JLM });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { resolvedTimeZone: "  " }));
    assert.deepEqual(rowCells(h), [], "a blank zone is not a zone");
    assert.equal(exportButton(h)?.disabled, true);
    assert.ok(button(h, "Retry"));
  });

  it("a LATER PAGE cannot redefine the session's timezone", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { hasMore: true })); // bound to JLM

    click(loadMoreButton(h)!);
    // The page comes back claiming a DIFFERENT zone — it cannot belong to this
    // session, so the session is stale rather than silently re-bound.
    await h.answerSearch(1, ok([movement("b")], { resolvedTimeZone: UTC }));
    assert.deepEqual(rowCells(h), [], "the session is invalidated, not re-bound");
    assert.ok(button(h, "Re-apply filter"));
    assert.equal(exportButton(h)?.disabled, true);
  });

  it("screen and CSV agree, and the browser timezone is irrelevant", async () => {
    const original = process.env.TZ;
    process.env.TZ = "Pacific/Kiritimati"; // a wildly different machine zone
    try {
      const h = mount({ initial: [], timeZone: JLM });
      selectOption(presetSelect(h), "today");
      await h.answerSearch(0, ok([movement("a")], { resolvedTimeZone: UTC }));

      const onScreen = rowCells(h)[0];
      assert.ok(onScreen.includes("09:57"), "the SESSION's zone, not the machine's");

      click(exportButton(h)!);
      await h.answerExport(0, okExport([movement("a")], { resolvedTimeZone: UTC }));
      assert.ok(h.csv[0].body.includes(onScreen), "CSV cell === screen cell");
      assert.ok(!h.csv[0].body.includes("12:57"));
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
describe("C3 — the EXPORT reply must name its zone, and the client must check it", () => {
  /** A UTC-resolved session on a page that was bootstrapped in Asia/Jerusalem. */
  async function utcSession() {
    const h = mount({ initial: [], timeZone: JLM });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { resolvedTimeZone: UTC }));
    assert.ok(rowCells(h)[0].includes("09:57"), "rows are in the SESSION's zone");
    return h;
  }

  it("a VALID export (zone matches the session) writes a CSV in that zone", async () => {
    const h = await utcSession();
    const onScreen = rowCells(h)[0];

    click(exportButton(h)!);
    assert.equal(h.exports[0].expectedTimeZone, UTC, "the request states its session");
    await h.answerExport(0, okExport([movement("a")], { resolvedTimeZone: UTC }));

    assert.equal(h.csv.length, 1, "a file was written");
    assert.ok(h.csv[0].body.includes("09:57"), "the CSV uses the SESSION's UTC clock");
    assert.ok(
      !h.csv[0].body.includes("12:57"),
      "the Asia/Jerusalem page prop does not reach the file",
    );
    assert.ok(h.csv[0].body.includes(onScreen), "CSV cell === screen cell");
    assert.ok(!text(h).includes("Could not export"), "no error");
  });

  it("a MISSING zone fails closed: no CSV, no rows processed, no fallback", async () => {
    const h = await utcSession();

    // A runtime-malformed success. The cast is the point: this reply crossed the
    // network, and TypeScript is not a trust boundary.
    const malformed = {
      ok: true,
      movements: [movement("x")],
      capped: false,
    } as unknown as MovementExportResult;

    click(exportButton(h)!);
    await h.answerExport(0, malformed);

    assert.equal(h.csv.length, 0, "NO file was written");
    assert.ok(text(h).includes("Could not export"), "a safe localized export failure");
    // The returned rows were never processed — under EITHER zone.
    assert.ok(!text(h).includes("12:57"), "no Asia/Jerusalem page-prop fallback");
    assert.ok(!text(h).includes("22:57"), "no browser/machine-zone fallback");
    // The VISIBLE session is intact: a malformed export reply does not prove the
    // session on screen is stale, so it is not thrown away.
    assert.equal(rowCells(h).length, 1, "the visible session survives");
    assert.ok(rowCells(h)[0].includes("09:57"));
    assert.equal(exportButton(h)?.disabled, false, "…and remains exportable");
    assert.equal(button(h, "Re-apply filter"), undefined, "it is not stale");
  });

  it("a BLANK zone fails closed the same way", async () => {
    const h = await utcSession();
    click(exportButton(h)!);
    await h.answerExport(0, okExport([movement("x")], { resolvedTimeZone: "   " }));

    assert.equal(h.csv.length, 0, "no file");
    assert.ok(text(h).includes("Could not export"));
    assert.equal(rowCells(h).length, 1, "the visible session survives");
  });

  it("a MISMATCHING zone stales the session — no CSV, no reinterpretation", async () => {
    const h = await utcSession(); // session is UTC

    click(exportButton(h)!);
    // A well-formed success that belongs to a DIFFERENT zone. Impossible against a
    // correct server (it refuses the mismatch first) — the client still fails closed.
    await h.answerExport(0, okExport([movement("x")], { resolvedTimeZone: JLM }));

    assert.equal(h.csv.length, 0, "NO file — the rows are not reinterpreted");
    assert.deepEqual(rowCells(h), [], "the visible rows are cleared");
    assert.equal(exportButton(h)?.disabled, true, "Export disabled");
    assert.equal(loadMoreButton(h), undefined, "Load more disabled");
    assert.ok(text(h).includes("business timezone changed"), "the stale explanation");
    const reapply = button(h, "Re-apply filter");
    assert.ok(reapply, "the existing Re-apply recovery is offered");

    // …and Re-apply resolves a fresh session normally, from offset zero.
    click(reapply!);
    assert.equal(h.searches.length, 2);
    assert.equal(h.searches[1].offset, 0, "offset zero");
    assert.equal(h.searches[1].expectedTimeZone, undefined, "no stale binding reused");
    await h.answerSearch(1, ok([movement("b")], { resolvedTimeZone: JLM }));
    assert.equal(rowCells(h).length, 1);
    assert.ok(rowCells(h)[0].includes("12:57"), "the NEW authoritative zone");
    assert.equal(exportButton(h)?.disabled, false, "Export works again");
  });

  it("after a malformed export, a later VALID export still succeeds", async () => {
    const h = await utcSession();

    click(exportButton(h)!);
    await h.answerExport(0, {
      ok: true,
      movements: [movement("x")],
      capped: false,
    } as unknown as MovementExportResult);
    assert.equal(h.csv.length, 0);
    assert.ok(text(h).includes("Could not export"));
    assert.equal(rowCells(h).length, 1, "the session was not corrupted");

    // Retry the export — nothing about the session changed, so it just works.
    click(exportButton(h)!);
    await h.answerExport(1, okExport([movement("a")], { resolvedTimeZone: UTC }));
    assert.equal(h.csv.length, 1, "a file is written");
    assert.ok(h.csv[0].body.includes("09:57"));
    assert.ok(!text(h).includes("Could not export"), "the error is cleared");
  });

  it("a capped export still names its zone and still writes the file", async () => {
    const h = await utcSession();
    click(exportButton(h)!);
    await h.answerExport(
      0,
      okExport([movement("a")], { capped: true, resolvedTimeZone: UTC }),
    );
    assert.equal(h.csv.length, 1, "the capped branch exports too");
    assert.ok(h.csv[0].body.includes("09:57"));
    assert.ok(text(h).length > 0, "the capped warning is shown");
  });
});

describe("accessibility — keyboard recovery and RTL", () => {
  it("Retry is reachable and activatable from the keyboard", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, { ok: false, error: "failed" });

    const retry = button(h, "Retry")!;
    assert.equal(retry.tagName, "BUTTON", "a semantic button, not a div");
    assert.equal(retry.getAttribute("type"), "button");
    assert.ok(!retry.disabled);

    assert.ok(focusIt(retry), "it takes focus — it is in the tab order");
    pressEnter(retry);
    assert.equal(h.searches.length, 2, "keyboard activation restarts the session");
    assert.equal(h.searches[1].offset, 0);
  });

  it("Re-apply is reachable and activatable from the keyboard", async () => {
    const h = mount({ initial: [] });
    selectOption(presetSelect(h), "today");
    await h.answerSearch(0, ok([movement("a")], { hasMore: true }));
    click(loadMoreButton(h)!);
    await h.answerSearch(1, { ok: false, error: "timezone_changed" });

    const reapply = button(h, "Re-apply filter")!;
    assert.equal(reapply.tagName, "BUTTON");
    assert.ok(focusIt(reapply), "it takes focus — it is in the tab order");
    pressEnter(reapply);
    assert.equal(h.searches.length, 3);
    assert.equal(h.searches[2].offset, 0, "offset zero");
    assert.equal(h.searches[2].expectedTimeZone, undefined, "no old binding");
  });

  it("Hebrew renders RTL-correct content with a bidi-safe timestamp", async () => {
    const he = mount({ initial: [], timeZone: JLM, locale: "he" });
    selectOption(presetSelect(he), "today");
    await he.answerSearch(0, ok([movement("a")]));

    const cell = rowCells(he)[0];
    assert.ok(cell.includes("12:57"), "the tenant wall clock, in Hebrew");
    assert.ok(/\d/.test(cell), "digits are Western (bidi-safe in an RTL line)");

    // The recovery strings are translated, not left in English.
    const heDict = getDictionary("he").admin.inventory.movements;
    const enDict = getDictionary("en").admin.inventory.movements;
    assert.notEqual(heDict.retry, enDict.retry);
    assert.notEqual(heDict.reapplyFilter, enDict.reapplyFilter);
    assert.notEqual(heDict.loadFailed, enDict.loadFailed);
    // Layout uses LOGICAL properties only — nothing hard-codes a physical side.
    const src = readFileSync(
      join(process.cwd(), "src/components/admin/movements-table.tsx"),
      "utf8",
    );
    assert.doesNotMatch(
      src,
      /className="[^"]*\b(ml-|mr-|pl-|pr-|left-|right-|text-left|text-right)/,
      "logical CSS only — a physical side would flip wrongly in RTL",
    );
  });
});

describe("architecture (what a render cannot show)", () => {
  it("no passive-effect invalidation, no hydration suppression, no server-only import", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/admin/movements-table.tsx"),
      "utf8",
    );
    // Invalidation happens in the HANDLER, in the same transition as the control —
    // and the REDUCER allocates the generation, so a no-op cannot burn one.
    assert.match(
      src,
      /function applyFilters\(patch: Partial<MovementFilters>, defer = false\)/,
    );
    assert.match(src, /dispatch\(\{ type: "filters_changed", patch, defer \}\)/);
    assert.doesNotMatch(src, /genRef/, "the component no longer allocates generations");
    // The SEARCH BOX is a filter like any other: it dispatches on change. It must NOT
    // keep its own useState, and the debounce must NOT be what invalidates.
    assert.match(
      src,
      /onChange=\{\(e\) => applyFilters\(\{ query: e\.target\.value \}, true\)\}/,
      "typing invalidates synchronously; only the request is deferred",
    );
    assert.doesNotMatch(src, /setQuery|useState\(""\)/, "no second query state");
    assert.doesNotMatch(src, /useLayoutEffect|flushSync|suppressHydrationWarning/);
    // No fallback may reintroduce the page prop as a session timezone.
    assert.doesNotMatch(
      src,
      /resolvedTimeZone \?\?/,
      "a success that cannot name its zone must FAIL, not borrow the page's",
    );
    assert.match(src, /isResolvedTimeZone\(result\.resolvedTimeZone\)/, "runtime guard");
    // The Server Actions are TYPE-ONLY imports, so no server-only module is dragged in.
    // TYPE-only import (erased at compile) — a runtime one would drag the server-only
    // Temporal module in and make the component unmountable. Line-ending agnostic:
    // git may check this file out with CRLF.
    assert.match(
      src,
      /import type \{[\s\S]*?\} from "@\/lib\/actions\/inventory";/,
      "the Server Actions are imported for their TYPES only",
    );
    assert.doesNotMatch(src, /^import \{[^}]*searchMovementsAction/m);
    // Rows format with the SESSION's zone, never the bootstrap prop.
    assert.match(src, /formatTenantDateTime\(m\.createdAt, locale, rowTimeZone\)/);
    assert.match(src, /formatTenantDateTime\(m\.createdAt, locale, exportTimeZone\)/);
    assert.doesNotMatch(
      src,
      /formatTenantDateTime\(m\.createdAt, locale, timeZone\)/,
      "the page prop must not format a resolved session's rows",
    );

    // The export reply is VERIFIED before a single row is read — the CSV must be
    // built after the zone checks, never before them.
    const exportFn = src.slice(src.indexOf("function onExport()"));
    const guardMissing = exportFn.indexOf("isResolvedTimeZone(result.resolvedTimeZone)");
    const guardMismatch = exportFn.indexOf("result.resolvedTimeZone !== exportTimeZone");
    const readsRows = exportFn.indexOf("const exportRows = result.movements");
    const buildsCsv = exportFn.indexOf("toCsv(");
    const writesFile = exportFn.indexOf("download(");
    assert.ok(guardMissing >= 0, "a malformed export reply is refused");
    assert.ok(guardMismatch >= 0, "a mismatched export reply stales the session");
    assert.ok(
      guardMissing < readsRows && guardMismatch < readsRows,
      "BOTH checks precede reading the returned rows",
    );
    assert.ok(readsRows < buildsCsv && buildsCsv < writesFile, "…and the CSV/file");
  });
});
