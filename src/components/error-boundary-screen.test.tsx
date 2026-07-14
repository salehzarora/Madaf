/**
 * PILOT-READINESS-BATCH-A / A2 — MOUNTED localized error-boundary tests.
 *
 * Mounts the REAL presentational error screen (the boundary delegates to it) with
 * the retry handler injected as a prop — the same seam the movements-table /
 * order-timeline suites use — so trilingual rendering, direction, alert
 * semantics, the keyboard-operable Retry, and the no-raw-error guarantee are all
 * verified behaviourally, plus source guards for the boundary's refresh+reset
 * retry and the "no full dictionaries in the error chunk" contract.
 *
 * Runner: `npm run test:error-boundary` (plain tsx — NOT --conditions=react-server,
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

import { ErrorBoundaryScreen } from "@/components/error-boundary-screen";

const readSrc = (rel: string): string =>
  readFileSync(join(process.cwd(), "src", rel), "utf8");

interface Harness {
  container: HTMLElement;
  retries: number;
  unmount: () => void;
}
let mounted: Harness[] = [];

function mount(opts: { locale: string; retrying?: boolean }): Harness {
  const container = dom.window.document.createElement("div");
  dom.window.document.body.appendChild(container);
  let retries = 0;
  const root = createRoot(container);
  act(() => {
    root.render(
      React.createElement(ErrorBoundaryScreen, {
        locale: opts.locale,
        retrying: opts.retrying ?? false,
        onRetry: () => {
          retries += 1;
          h.retries = retries;
        },
      }),
    );
  });
  const h: Harness = {
    container: container as unknown as HTMLElement,
    retries: 0,
    unmount() {
      act(() => root.unmount());
      container.remove();
    },
  };
  mounted.push(h);
  return h;
}

afterEach(() => {
  for (const h of mounted) h.unmount();
  mounted = [];
});

const $ = (h: Harness, sel: string) => h.container.querySelector(sel);
const text = (h: Harness) => h.container.textContent ?? "";
const retryBtn = (h: Harness) =>
  [...h.container.querySelectorAll("button")].find(
    (b) => (b.getAttribute("type") ?? "") === "button",
  ) as HTMLButtonElement | undefined;

// The exact copy the screen renders (kept in sync deliberately — a divergence
// would mean the strings changed and the test should be reviewed).
const TITLES = {
  ar: "حدث خطأ ما",
  he: "משהו השתבש",
  en: "Something went wrong",
};

describe("ErrorBoundaryScreen — localization + direction", () => {
  for (const [locale, title] of Object.entries(TITLES) as [
    keyof typeof TITLES,
    string,
  ][]) {
    it(`renders ${locale} title and correct direction`, () => {
      const h = mount({ locale });
      assert.ok(text(h).includes(title), `${locale} title present`);
      const main = $(h, "main")!;
      const expectedDir = locale === "en" ? "ltr" : "rtl";
      assert.equal(main.getAttribute("dir"), expectedDir);
      assert.equal(main.getAttribute("lang"), locale);
      // The OTHER languages' titles must not bleed in.
      for (const [other, otherTitle] of Object.entries(TITLES)) {
        if (other !== locale) assert.ok(!text(h).includes(otherTitle));
      }
    });
  }

  it("an unknown locale falls back to Hebrew (the default), not English", () => {
    const h = mount({ locale: "zz" });
    assert.ok(text(h).includes(TITLES.he));
    assert.equal($(h, "main")!.getAttribute("dir"), "rtl");
  });
});

describe("ErrorBoundaryScreen — accessibility + safety", () => {
  it("announces the failure via role=alert (not color/icon alone)", () => {
    const h = mount({ locale: "en" });
    const alert = $(h, '[role="alert"]');
    assert.ok(alert, "an alert region exists");
    assert.ok((alert!.textContent ?? "").includes(TITLES.en));
    // There is a heading for the error.
    assert.ok($(h, "h1"));
  });

  it("renders NO raw error text — the screen never receives message/stack/digest", () => {
    const h = mount({ locale: "en" });
    const body = text(h);
    // Only the fixed safe copy is present; no backend/stack/digest detail.
    assert.doesNotMatch(body, /Error:|stack|digest|PGRST|supabase|postgres|at \w+ \(/i);
    // The component's props type carries no `error` at all (compile-time
    // contract), and the boundary passes none (source-guarded below) — so there
    // is structurally nothing raw it could render. The visible copy is the calm
    // English title + retry only.
    assert.ok(body.includes(TITLES.en));
    assert.ok(body.toLowerCase().includes("try again"));
  });

  it("the Retry control is a keyboard-operable button and invokes onRetry", () => {
    const h = mount({ locale: "en" });
    const btn = retryBtn(h)!;
    assert.ok(btn, "a retry button exists");
    assert.equal(btn.tagName, "BUTTON"); // natively keyboard-operable (Enter/Space)
    assert.equal(btn.disabled, false);
    // Focusable.
    btn.focus();
    assert.equal(dom.window.document.activeElement, btn);
    act(() => {
      btn.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
    });
    assert.equal(h.retries, 1, "clicking Retry called the injected handler");
  });

  it("shows a busy, disabled Retry while a refresh is pending", () => {
    const h = mount({ locale: "he", retrying: true });
    const btn = retryBtn(h)!;
    assert.equal(btn.disabled, true);
    assert.equal(btn.getAttribute("aria-busy"), "true");
  });

  it("offers a safe home link to the locale root", () => {
    const h = mount({ locale: "ar" });
    const home = [...h.container.querySelectorAll("a")].find(
      (a) => a.getAttribute("href") === "/ar",
    );
    assert.ok(home, "a /<locale> home link is present");
  });
});

describe("ErrorBoundaryScreen — source contracts", () => {
  it("the error chunk imports NO full application dictionary", () => {
    const screen = readSrc("components/error-boundary-screen.tsx");
    assert.doesNotMatch(screen, /@\/i18n\/dictionaries/);
    // A small inline per-locale map is used instead.
    assert.match(screen, /const MESSAGES: Record<Locale/);
  });

  it("the boundary retries via router.refresh() + reset() in a transition, not reset alone", () => {
    const raw = readSrc("app/[locale]/error.tsx");
    // Scan CODE only — a doc comment mentioning router.refresh() must not satisfy
    // the guard (a probe that deleted the real call while leaving the comment
    // otherwise slips through).
    const code = raw
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.match(raw, /"use client"/);
    // The retry BODY must contain both refresh and reset inside a transition.
    const body = code.slice(code.indexOf("startTransition"));
    assert.match(body, /router\.refresh\(\)/, "retry calls router.refresh()");
    assert.match(body, /reset\(\)/, "retry calls reset()");
    assert.match(code, /startTransition\(/);
    // The raw error is logged, never passed to the presentational screen.
    assert.match(code, /console\.error/);
    assert.doesNotMatch(code, /error=\{error\}|message=\{|error\.message/);
  });
});
