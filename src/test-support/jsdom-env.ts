/**
 * A minimal DOM for MOUNTED component tests (M8H.2).
 *
 * Test-support only — nothing in `src/app` or `src/components` imports it, so it
 * never reaches a bundle. It exists because reducer-only tests let three real
 * integration defects through: the component has to actually be *rendered* for
 * "does the next committed render still show the old rows?" to be answerable.
 *
 * Import this BEFORE `react-dom/client`: the globals must exist by the time React's
 * DOM renderer is evaluated. (tsx compiles to CJS, so imports run in source order —
 * a side-effect import at the top is exactly the ordering guarantee we need, and
 * top-level `await` is not available to us here.)
 */
import { JSDOM } from "jsdom";

export const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
  pretendToBeVisual: true,
});

const g = globalThis as unknown as Record<string, unknown>;
g.window = dom.window;
g.document = dom.window.document;
// Node ≥21 defines `globalThis.navigator` as a getter-only accessor, so it must be
// redefined rather than assigned.
Object.defineProperty(globalThis, "navigator", {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
g.HTMLElement = dom.window.HTMLElement;
g.HTMLSelectElement = dom.window.HTMLSelectElement;
g.HTMLInputElement = dom.window.HTMLInputElement;
g.HTMLButtonElement = dom.window.HTMLButtonElement;
g.Element = dom.window.Element;
g.Node = dom.window.Node;
g.Event = dom.window.Event;
g.MouseEvent = dom.window.MouseEvent;
g.getComputedStyle = dom.window.getComputedStyle;
/** React 19 refuses to run `act` outside a declared act environment. */
g.IS_REACT_ACT_ENVIRONMENT = true;
