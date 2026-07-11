/**
 * Focused tests for the canonical public-URL helper (M8E.2).
 *
 * Runs under the Node built-in test runner with type-stripping — there is no
 * test framework in this repo. From the project root:
 *
 *   node --experimental-strip-types --test src/lib/public-url.test.ts
 *
 * Excluded from the app build/lint (tsconfig `exclude` + eslint ignore), so it
 * never enters the production bundle or type-check.
 */
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  absolutePublicUrl,
  buildPublicTokenUrl,
  canonicalOrigin,
  normalizeOrigin,
} from "./public-url.ts";

const CANON = "https://madaf-drab.vercel.app";
const PREVIEW = "https://madaf-abc123def-salehzaroras-projects.vercel.app";
const TOKEN = "AbC-123_xyzTOKEN-do-not-mutate";

function setWindow(origin: string): void {
  (globalThis as Record<string, unknown>).window = { location: { origin } };
}

function reset(): void {
  delete process.env.NEXT_PUBLIC_APP_URL;
  delete process.env.NEXT_PUBLIC_SITE_URL;
  delete (globalThis as Record<string, unknown>).window;
}

beforeEach(reset);

// (1) A preview/request origin must NOT appear in a generated public link.
test("preview/request origin never leaks into a generated link", () => {
  process.env.NEXT_PUBLIC_APP_URL = CANON;
  setWindow(PREVIEW); // admin sitting on a preview deploy
  const url = buildPublicTokenUrl({ locale: "ar", routeType: "showcase", token: TOKEN });
  assert.ok(url);
  assert.ok(url.startsWith(CANON), "must use the canonical origin");
  assert.ok(!url.includes("salehzaroras-projects"), "preview host must not appear");
  assert.ok(!url.includes(".vercel.app/ar") || url.startsWith(CANON));
});

// (2)-(5) Each public route type uses the canonical origin.
for (const routeType of ["shop", "showcase", "join", "invite"] as const) {
  test(`${routeType} link uses the canonical origin`, () => {
    process.env.NEXT_PUBLIC_APP_URL = CANON;
    const url = buildPublicTokenUrl({ locale: "he", routeType, token: TOKEN });
    assert.equal(url, `${CANON}/he/${routeType}/${TOKEN}`);
  });
}

// (6) ar / he / en locale paths are preserved exactly.
test("all three locales are preserved in the path", () => {
  process.env.NEXT_PUBLIC_APP_URL = CANON;
  for (const locale of ["ar", "he", "en"] as const) {
    assert.equal(
      buildPublicTokenUrl({ locale, routeType: "shop", token: TOKEN }),
      `${CANON}/${locale}/shop/${TOKEN}`,
    );
  }
});

// (7) The token is preserved verbatim (never transformed).
test("token is preserved without modification", () => {
  process.env.NEXT_PUBLIC_APP_URL = CANON;
  const url = buildPublicTokenUrl({ locale: "en", routeType: "invite", token: TOKEN });
  assert.ok(url);
  assert.ok(url.endsWith(`/${TOKEN}`), "token suffix unchanged");
  // absolutePublicUrl preserves an already-built relative path verbatim.
  assert.equal(
    absolutePublicUrl(`/en/shop/${TOKEN}`),
    `${CANON}/en/shop/${TOKEN}`,
  );
});

// (8) Trailing slashes on the configured origin are normalized away.
test("trailing slash on the canonical origin is normalized", () => {
  process.env.NEXT_PUBLIC_APP_URL = "https://madaf-drab.vercel.app/";
  assert.equal(normalizeOrigin("https://madaf-drab.vercel.app/"), CANON);
  assert.equal(
    buildPublicTokenUrl({ locale: "ar", routeType: "shop", token: TOKEN }),
    `${CANON}/ar/shop/${TOKEN}`,
  );
});

// (9) A configured origin with a path is reduced to origin-only; malformed /
//     non-http values are rejected (null).
test("origin with a path is normalized to origin-only; malformed is rejected", () => {
  assert.equal(normalizeOrigin("https://madaf-drab.vercel.app/some/path?q=1#h"), CANON);
  assert.equal(normalizeOrigin("not a url"), null);
  assert.equal(normalizeOrigin("ftp://example.com"), null);
  assert.equal(normalizeOrigin(""), null);
  assert.equal(normalizeOrigin(undefined), null);
  // A configured origin carrying a path still yields a clean link.
  process.env.NEXT_PUBLIC_APP_URL = "https://madaf-drab.vercel.app/base/";
  assert.equal(
    buildPublicTokenUrl({ locale: "he", routeType: "join", token: TOKEN }),
    `${CANON}/he/join/${TOKEN}`,
  );
});

// (10) Local/mock fallback: no env configured + a localhost window → localhost.
test("local dev falls back to the localhost request origin", () => {
  setWindow("http://localhost:3000");
  const res = canonicalOrigin();
  assert.equal(res.origin, "http://localhost:3000");
  assert.equal(
    buildPublicTokenUrl({ locale: "en", routeType: "showcase", token: TOKEN }),
    `http://localhost:3000/en/showcase/${TOKEN}`,
  );
});

// (10b) Hosted with NO env + a non-local origin → refuse (never leak preview).
test("hosted without config refuses to leak a preview origin", () => {
  setWindow(PREVIEW);
  const res = canonicalOrigin();
  assert.equal(res.origin, null);
  assert.equal(res.reason, "unconfigured-hosted");
  assert.equal(buildPublicTokenUrl({ locale: "ar", routeType: "shop", token: TOKEN }), null);
  assert.equal(absolutePublicUrl(`/ar/shop/${TOKEN}`), null);
});

// (10c) NEXT_PUBLIC_SITE_URL is honored as the secondary source.
test("NEXT_PUBLIC_SITE_URL is used when APP_URL is unset", () => {
  process.env.NEXT_PUBLIC_SITE_URL = CANON;
  setWindow(PREVIEW);
  assert.equal(canonicalOrigin().origin, CANON);
});

// (11) Existing relative navigation is not affected: the helper only prepends
//      an origin and leaves the relative path untouched; invalid parts yield
//      null (callers keep using relative <Link href> as before).
test("relative path is preserved and invalid parts yield null", () => {
  process.env.NEXT_PUBLIC_APP_URL = CANON;
  assert.equal(absolutePublicUrl("/he/admin/orders"), `${CANON}/he/admin/orders`);
  // Invalid locale / empty token → null (no misleading link built).
  assert.equal(buildPublicTokenUrl({ locale: "ARABIC", routeType: "shop", token: TOKEN }), null);
  assert.equal(buildPublicTokenUrl({ locale: "ar", routeType: "shop", token: "" }), null);
});

// (12) No raw token is logged during link generation.
test("no raw token is written to the console during link generation", () => {
  process.env.NEXT_PUBLIC_APP_URL = CANON;
  const methods = ["log", "info", "warn", "error", "debug"] as const;
  const original: Record<string, unknown> = {};
  const calls: unknown[] = [];
  for (const m of methods) {
    original[m] = (console as Record<string, unknown>)[m];
    (console as Record<string, unknown>)[m] = (...args: unknown[]) => {
      calls.push(...args);
    };
  }
  try {
    buildPublicTokenUrl({ locale: "he", routeType: "shop", token: TOKEN });
    absolutePublicUrl(`/he/shop/${TOKEN}`);
    canonicalOrigin();
    normalizeOrigin(`https://x.example/${TOKEN}`);
  } finally {
    for (const m of methods) {
      (console as Record<string, unknown>)[m] = original[m];
    }
  }
  const dump = calls.map((c) => (typeof c === "string" ? c : JSON.stringify(c))).join(" ");
  assert.ok(!dump.includes(TOKEN), "the raw token must never be logged");
});
