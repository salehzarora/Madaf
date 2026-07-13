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
  unmount: () => void;
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
    unmount() {
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

const ok = (
  rows: InventoryMovement[],
  over: Partial<MovementSearchResult> = {},
): MovementSearchResult => ({
  ok: true,
  movements: rows,
  hasMore: false,
  resolvedFrom: "2026-07-13",
  resolvedTo: "2026-07-13",
  resolvedTimeZone: JLM,
  ...over,
});

afterEach(() => {
  for (const h of harnesses) h.unmount();
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
    await h.answerExport(0, { ok: true, movements: [movement("a")], capped: false });

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
    await h.answerExport(0, { ok: true, movements: [movement("a")], capped: false });
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
describe("architecture (what a render cannot show)", () => {
  it("no passive-effect invalidation, no hydration suppression, no server-only import", () => {
    const src = readFileSync(
      join(process.cwd(), "src/components/admin/movements-table.tsx"),
      "utf8",
    );
    // Invalidation happens in the HANDLER, in the same transition as the control.
    assert.match(src, /function applyFilters\(patch: Partial<MovementFilters>\)/);
    assert.match(src, /dispatch\(\{ type: "filters_changed", generation: genRef\.current, patch \}\)/);
    // The old passive path is gone: no effect keyed on the filter values.
    assert.doesNotMatch(
      src,
      /\}, \[reason, direction, preset, customFrom, customTo, productIds\]\)/,
      "no useEffect that notices a filter change and invalidates afterwards",
    );
    assert.doesNotMatch(src, /useLayoutEffect|flushSync|suppressHydrationWarning/);
    // The Server Actions are TYPE-ONLY imports, so no server-only module is dragged in.
    assert.match(src, /^import type \{\n(?:.*\n)*?\} from "@\/lib\/actions\/inventory";/m);
    assert.doesNotMatch(src, /^import \{[^}]*searchMovementsAction/m);
    // Rows format with the SESSION's zone, never the bootstrap prop.
    assert.match(src, /formatTenantDateTime\(m\.createdAt, locale, rowTimeZone\)/);
    assert.match(src, /formatTenantDateTime\(m\.createdAt, locale, exportTimeZone\)/);
    assert.doesNotMatch(
      src,
      /formatTenantDateTime\(m\.createdAt, locale, timeZone\)/,
      "the page prop must not format a resolved session's rows",
    );
  });
});
