/**
 * Canonical public-link test suite (M8E.2). Covers the pure validator
 * (`public-url.ts`), the mutation-ordering orchestrator (`public-link.ts`), and
 * the deployment-safety enforcement (`config/deployment-safety.ts`).
 *
 * Runner: `npm run test:public-url` (tsx → Node's built-in test runner). These
 * are the SAME functions the production actions/managers/linter use.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  buildPublicTokenUrl,
  isDisplayablePublicUrl,
  isLoopbackOrigin,
  isValidPublicToken,
  normalizeCanonicalOrigin,
  resolveConfiguredOrigin,
  type OriginResult,
} from "./public-url";
import { createCanonicalLink } from "./public-link";
import { assessDeploymentSafety } from "./config/deployment-safety";

const CANON = "https://madaf-drab.vercel.app";
// A syntactically valid link token (32 random bytes, base64url → 43 chars).
const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-ABCDE";

function okOrigin(r: OriginResult): string {
  assert.ok(r.ok, `expected ok origin, got ${JSON.stringify(r)}`);
  return r.origin;
}

function reasonOf(r: OriginResult): string {
  assert.ok(!r.ok, `expected a failed origin, got ${JSON.stringify(r)}`);
  return r.reason;
}

// ── 1. normalizeCanonicalOrigin — strict URL contract ──────────────────────
test("normalizeCanonicalOrigin accepts a clean http(s) origin", () => {
  assert.equal(okOrigin(normalizeCanonicalOrigin(CANON)), CANON);
  assert.equal(okOrigin(normalizeCanonicalOrigin("http://example.com:8080")), "http://example.com:8080");
});

test("normalizeCanonicalOrigin normalizes ONLY a trailing root slash", () => {
  assert.equal(okOrigin(normalizeCanonicalOrigin("https://madaf-drab.vercel.app/")), CANON);
});

test("normalizeCanonicalOrigin rejects a path / query / fragment (no silent stripping)", () => {
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app/base").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app/a/b").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app?x=1").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app#h").ok, false);
});

test("normalizeCanonicalOrigin rejects credentials", () => {
  assert.equal(normalizeCanonicalOrigin("https://user:pass@evil.example").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://user@evil.example").ok, false);
});

test("normalizeCanonicalOrigin rejects protocol-relative + dangerous/non-http schemes", () => {
  assert.equal(normalizeCanonicalOrigin("//madaf-drab.vercel.app").ok, false);
  assert.equal(normalizeCanonicalOrigin("javascript:alert(1)").ok, false);
  assert.equal(normalizeCanonicalOrigin("data:text/html,x").ok, false);
  assert.equal(normalizeCanonicalOrigin("file:///etc/passwd").ok, false);
  assert.equal(normalizeCanonicalOrigin("ftp://example.com").ok, false);
});

test("normalizeCanonicalOrigin rejects control chars, whitespace, non-ASCII, blank", () => {
  assert.equal(normalizeCanonicalOrigin("https://mad af.vercel.app").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://exämple.com").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://exa\tmple.com").ok, false);
  assert.equal(normalizeCanonicalOrigin("not a url").ok, false);
  assert.equal(reasonOf(normalizeCanonicalOrigin("")), "missing");
  assert.equal(reasonOf(normalizeCanonicalOrigin(undefined)), "missing");
});

// ── 2. resolveConfiguredOrigin — precedence + conflict ─────────────────────
test("APP_URL is primary; SITE_URL used only when APP is absent", () => {
  assert.equal(okOrigin(resolveConfiguredOrigin(CANON, undefined)), CANON);
  assert.equal(okOrigin(resolveConfiguredOrigin(undefined, CANON)), CANON);
  assert.equal(okOrigin(resolveConfiguredOrigin("  ", CANON)), CANON); // blank primary → site
});

test("an INVALID primary fails (never falls through to the secondary)", () => {
  const r = resolveConfiguredOrigin("https://bad url/path", CANON);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("an invalid SECONDARY fails only when it is selected", () => {
  assert.equal(resolveConfiguredOrigin(undefined, "javascript:alert(1)").ok, false);
  // App valid + site invalid → app is used (site not selected).
  assert.equal(okOrigin(resolveConfiguredOrigin(CANON, "not a url")), CANON);
});

test("two valid-but-different origins are a conflict; identical ones succeed", () => {
  const conflict = resolveConfiguredOrigin(CANON, "https://other.example");
  assert.equal(conflict.ok, false);
  assert.equal(conflict.ok === false && conflict.reason, "conflict");
  assert.equal(okOrigin(resolveConfiguredOrigin(CANON, "https://madaf-drab.vercel.app/")), CANON);
});

test("neither variable set → missing", () => {
  assert.equal(reasonOf(resolveConfiguredOrigin(undefined, undefined)), "missing");
});

// ── 3. isLoopbackOrigin — loopback ONLY ────────────────────────────────────
test("isLoopbackOrigin accepts real loopback (http + https)", () => {
  for (const o of [
    "http://localhost",
    "https://localhost",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:8080",
    "http://[::1]:3000",
  ]) {
    assert.equal(isLoopbackOrigin(o), true, o);
  }
});

test("isLoopbackOrigin rejects .local, LAN, lookalikes, and non-http(s)", () => {
  for (const o of [
    "http://warehouse.local",
    "http://localhost.evil.example",
    "http://192.168.1.10:3000",
    "http://my-nas:3000",
    "ftp://localhost",
  ]) {
    assert.equal(isLoopbackOrigin(o), false, o);
  }
});

// ── 4. isValidPublicToken — base64url, 43 chars ────────────────────────────
test("isValidPublicToken accepts the generator format and rejects the rest", () => {
  assert.equal(isValidPublicToken(TOKEN), true);
  assert.equal(isValidPublicToken("short"), false);
  assert.equal(isValidPublicToken(TOKEN + "x"), false); // 44 chars
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + "/"), false); // slash
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + "\\"), false); // backslash
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + "."), false); // dot segment char
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + "%"), false); // percent-encoding
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + "?"), false); // query delimiter
  assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + " "), false); // whitespace
  assert.equal(isValidPublicToken(""), false);
});

// ── 5. buildPublicTokenUrl — every part validated, per-route ───────────────
test("buildPublicTokenUrl builds each route type + each locale correctly", () => {
  for (const routeType of ["shop", "showcase", "join", "invite"] as const) {
    const r = buildPublicTokenUrl({ origin: CANON, locale: "he", routeType, token: TOKEN });
    assert.equal(r.ok && r.url, `${CANON}/he/${routeType}/${TOKEN}`);
  }
  for (const locale of ["ar", "he", "en"] as const) {
    const r = buildPublicTokenUrl({ origin: CANON, locale, routeType: "shop", token: TOKEN });
    assert.equal(r.ok && r.url, `${CANON}/${locale}/shop/${TOKEN}`);
  }
});

test("buildPublicTokenUrl rejects a bad origin / locale / route / token", () => {
  assert.equal(buildPublicTokenUrl({ origin: "not-a-url", locale: "he", routeType: "shop", token: TOKEN }).ok, false);
  const badOrigin = buildPublicTokenUrl({ origin: "//preview.vercel.app", locale: "he", routeType: "shop", token: TOKEN });
  assert.equal(badOrigin.ok === false && badOrigin.reason, "origin");
  const badLocale = buildPublicTokenUrl({ origin: CANON, locale: "ARABIC", routeType: "shop", token: TOKEN });
  assert.equal(badLocale.ok === false && badLocale.reason, "locale");
  // A malformed/ambiguous token (slash, dot segment, query, control) → rejected.
  for (const bad of [TOKEN.slice(0, 42) + "/", TOKEN.slice(0, 40) + "/..", TOKEN.slice(0, 42) + "?", "short"]) {
    const r = buildPublicTokenUrl({ origin: CANON, locale: "he", routeType: "shop", token: bad });
    assert.equal(r.ok === false && r.reason, "token", bad);
  }
});

// ── 6. isDisplayablePublicUrl — client copy-control guard ───────────────────
test("isDisplayablePublicUrl accepts a valid absolute canonical link only", () => {
  assert.equal(isDisplayablePublicUrl(`${CANON}/ar/showcase/${TOKEN}`), true);
  assert.equal(isDisplayablePublicUrl(`/ar/showcase/${TOKEN}`), false); // relative
  assert.equal(isDisplayablePublicUrl(null), false);
  assert.equal(isDisplayablePublicUrl(undefined), false);
  assert.equal(isDisplayablePublicUrl(`${CANON}/ar/showcase/${TOKEN}?x=1`), false); // query
  assert.equal(isDisplayablePublicUrl(`${CANON}/ar/showcase`), false); // wrong segment count
  assert.equal(isDisplayablePublicUrl(`${CANON}/ar/bogus/${TOKEN}`), false); // bad route
  assert.equal(isDisplayablePublicUrl(`${CANON}/xx/shop/${TOKEN}`), false); // bad locale
  assert.equal(isDisplayablePublicUrl("javascript:alert(1)"), false);
});

// ── 7. createCanonicalLink — MUTATION ORDERING ─────────────────────────────
test("createCanonicalLink does NOT run the mutation when the origin resolver fails", async () => {
  const persist = mock.fn(async () => {});
  const result = await createCanonicalLink({
    locale: "he",
    routeType: "shop",
    resolveOrigin: async () => ({ ok: false, reason: "missing" }) as OriginResult,
    persist,
  });
  assert.equal(result.ok, false);
  assert.equal(result.ok === false && result.reason, "config");
  assert.equal(persist.mock.callCount(), 0, "mutation must not run on config failure");
});

test("createCanonicalLink does NOT run the mutation when a part is invalid (bad locale)", async () => {
  const persist = mock.fn(async () => {});
  const result = await createCanonicalLink({
    locale: "ARABIC",
    routeType: "shop",
    resolveOrigin: async () => ({ ok: true, origin: CANON }),
    persist,
  });
  assert.equal(result.ok, false);
  assert.equal(persist.mock.callCount(), 0);
});

test("createCanonicalLink runs the mutation ONCE with a valid token + absolute canonical url", async () => {
  let seen: { rawToken: string; url: string } | null = null;
  const persist = mock.fn(async (link: { rawToken: string; url: string }) => {
    seen = link;
  });
  const result = await createCanonicalLink({
    locale: "ar",
    routeType: "showcase",
    resolveOrigin: async () => ({ ok: true, origin: CANON }),
    persist,
  });
  assert.equal(persist.mock.callCount(), 1);
  assert.ok(result.ok);
  const link = seen as unknown as { rawToken: string; url: string };
  assert.ok(isValidPublicToken(link.rawToken), "generated token is valid base64url");
  assert.equal(link.url, `${CANON}/ar/showcase/${link.rawToken}`);
  assert.ok(result.ok && result.url.startsWith(CANON));
});

test("createCanonicalLink never logs the raw token", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    mock.method(console, m, () => {}),
  );
  let token = "";
  try {
    await createCanonicalLink({
      locale: "he",
      routeType: "join",
      resolveOrigin: async () => ({ ok: true, origin: CANON }),
      persist: async ({ rawToken }) => {
        token = rawToken;
      },
    });
  } finally {
    mock.restoreAll();
  }
  for (const spy of spies) {
    for (const call of spy.mock.calls) {
      const dump = call.arguments.map((a) => String(a)).join(" ");
      assert.ok(!dump.includes(token), "raw token must never be logged");
    }
  }
});

// ── 8. Deployment safety — canonical URL is MANDATORY for hosted Supabase ───
const HOSTED_BASE: Record<string, string> = {
  NEXT_PUBLIC_MADAF_DATA_MODE: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
};

function assessHosted(extra: Record<string, string | undefined>) {
  const env: Record<string, string | undefined> = { ...HOSTED_BASE, ...extra };
  return assessDeploymentSafety(env, { treatAsDeploy: true });
}

test("hosted Supabase deploy with a valid distinct canonical URL is OK", () => {
  const r = assessHosted({ NEXT_PUBLIC_APP_URL: CANON, VERCEL_URL: "madaf-xyz-team.vercel.app" });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("hosted Supabase deploy MISSING the canonical URL is an ERROR", () => {
  const r = assessHosted({});
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("NEXT_PUBLIC_APP_URL")));
});

test("hosted Supabase deploy with an INVALID canonical URL is an ERROR", () => {
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: "https://x.example/path" }).ok, false);
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: "user:pass@x.example" }).ok, false);
});

test("hosted Supabase deploy with CONFLICTING app/site origins is an ERROR", () => {
  const r = assessHosted({ NEXT_PUBLIC_APP_URL: CANON, NEXT_PUBLIC_SITE_URL: "https://other.example" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("different")));
});

test("hosted Supabase deploy with a LOOPBACK canonical URL is an ERROR", () => {
  const r = assessHosted({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("loopback")));
});

test("canonical URL equal to the per-deploy Vercel host is REJECTED", () => {
  const r = assessHosted({ NEXT_PUBLIC_APP_URL: CANON, VERCEL_URL: "madaf-drab.vercel.app" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("per-deploy")));
});

test("local/mock (not a hosted Supabase deploy) needs no canonical URL", () => {
  assert.equal(assessDeploymentSafety({}, {}).ok, true);
  assert.equal(
    assessDeploymentSafety({ NEXT_PUBLIC_MADAF_DATA_MODE: "mock" }, {}).ok,
    true,
  );
});
