import { dom } from "@/test-support/jsdom-env";
import assert from "node:assert/strict";
import { test } from "node:test";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { LocaleSwitcher } from "./locale-switcher";
import { persistLocale } from "@/i18n/locale-preference";
import type { Locale } from "@/i18n/config";

for (const variant of ["segmented", "compact"] as const) {
  test(`${variant}: query preserved and preference written synchronously before navigation`, () => {
    dom.reconfigure({ url: "https://madaf.test/he/admin/orders?status=new&page=2" });
    const container = document.createElement("div"); document.body.append(container);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <PathnameContext.Provider value="/he/admin/orders">
          <SearchParamsContext.Provider value={new URLSearchParams("status=new&page=2&tag=a&tag=b")}>
            <LocaleSwitcher current="he" variant={variant} />
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>,
      ));
      for (const locale of ["ar", "en", "he"]) {
        if (variant === "compact") act(() => container.querySelector("button")!.click());
        const link = container.querySelector<HTMLAnchorElement>(`a[href^='/${locale}/']`)!;
        assert.equal(link.getAttribute("href"), `/${locale}/admin/orders?status=new&page=2&tag=a&tag=b`);
        let observed = false;
        const observe = (event: Event) => {
          observed = true;
          assert.equal(document.cookie, `madaf_locale=${locale}`);
          event.preventDefault(); // No navigation in jsdom; React's click already ran.
        };
        document.addEventListener("click", observe, { once: true });
        // Modified click avoids Next's client-router dependency, but still persists choice.
        act(() => link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true })));
        assert.equal(observed, true);
        const cookie = dom.cookieJar.getCookiesSync("https://madaf.test/").find(c => c.key === "madaf_locale")!;
        assert.equal(cookie.path, "/"); assert.equal(cookie.sameSite, "lax");
        assert.equal(cookie.maxAge, 31536000); assert.equal(cookie.secure, true);
        assert.equal(cookie.httpOnly, false);
      }
      // A subsequent app/root launch on the same origin retains the chosen preference.
      dom.reconfigure({ url: "https://madaf.test/" });
      assert.equal(document.cookie, "madaf_locale=he");
    } finally {
      act(() => root.unmount()); container.remove(); dom.cookieJar.removeAllCookiesSync();
    }
  });
}

test("HTTP development cookie works; invalid values and blocked storage cannot break navigation", () => {
  dom.reconfigure({ url: "http://localhost/" });
  persistLocale("ar");
  assert.equal(document.cookie, "madaf_locale=ar");
  assert.equal(dom.cookieJar.getCookiesSync("http://localhost/")[0].secure, false);
  persistLocale("bad; injected=true" as Locale);
  assert.equal(document.cookie, "madaf_locale=ar");
  Object.defineProperty(document, "cookie", { configurable: true, set() { throw new Error("blocked"); } });
  try { assert.doesNotThrow(() => persistLocale("en")); }
  finally { Reflect.deleteProperty(document, "cookie"); dom.cookieJar.removeAllCookiesSync(); }
});
