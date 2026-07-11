/**
 * Canonical public-link test suite (M8E.2). Covers the pure validator
 * (`public-url.ts`), the mutation-ordering orchestrator (`public-link.ts`), the
 * deployment-safety enforcement (`config/deployment-safety.ts`), and the
 * client error-category mapping. These are the SAME functions the production
 * actions/managers/linter/build-gate use.
 *
 * Runner: `npm run test:public-url` (tsx → Node's built-in test runner). NOTE:
 * tsx EXECUTES this file; TypeScript CHECKING is `npx tsc --noEmit` (both run
 * in CI). The database-side atomicity/concurrency of the replacement RPC is
 * covered separately by `supabase/tests/replace_customer_access_link.test.sql`.
 */
import assert from "node:assert/strict";
import { mock, test } from "node:test";

import {
  buildPublicTokenUrl,
  clientCanonicalOrigin,
  hostnameOf,
  isDisplayablePublicUrl,
  isLoopbackOrigin,
  isRejectedVercelHost,
  isValidPublicToken,
  normalizeCanonicalOrigin,
  resolveConfiguredOrigin,
  type OriginResult,
} from "./public-url";
import { createCanonicalLink } from "./public-link";
import { isInactiveStoreError } from "./actions/link-errors";
import { linkErrorMessage } from "../components/admin/link-error-message";
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
/** Run `fn` with NEXT_PUBLIC_* overridden, then restore. */
function withPublicEnv(
  vars: { app?: string; site?: string },
  fn: () => void,
): void {
  const prevApp = process.env.NEXT_PUBLIC_APP_URL;
  const prevSite = process.env.NEXT_PUBLIC_SITE_URL;
  if ("app" in vars) {
    if (vars.app === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = vars.app;
  } else {
    delete process.env.NEXT_PUBLIC_APP_URL;
  }
  if ("site" in vars) {
    if (vars.site === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = vars.site;
  } else {
    delete process.env.NEXT_PUBLIC_SITE_URL;
  }
  try {
    fn();
  } finally {
    if (prevApp === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = prevApp;
    if (prevSite === undefined) delete process.env.NEXT_PUBLIC_SITE_URL;
    else process.env.NEXT_PUBLIC_SITE_URL = prevSite;
  }
}

// ── 1. normalizeCanonicalOrigin — strict URL contract ──────────────────────
test("normalizeCanonicalOrigin accepts a clean http(s) origin", () => {
  assert.equal(okOrigin(normalizeCanonicalOrigin(CANON)), CANON);
  assert.equal(okOrigin(normalizeCanonicalOrigin("http://example.com:8080")), "http://example.com:8080");
});

test("normalizeCanonicalOrigin normalizes ONLY a trailing root slash", () => {
  assert.equal(okOrigin(normalizeCanonicalOrigin("https://madaf-drab.vercel.app/")), CANON);
});

test("normalizeCanonicalOrigin rejects a path / query / fragment", () => {
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app/base").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app?x=1").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app#h").ok, false);
});

test("normalizeCanonicalOrigin rejects credentials, protocol-relative, dangerous schemes", () => {
  assert.equal(normalizeCanonicalOrigin("https://user:pass@evil.example").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://user@evil.example").ok, false);
  assert.equal(normalizeCanonicalOrigin("//madaf-drab.vercel.app").ok, false);
  assert.equal(normalizeCanonicalOrigin("javascript:alert(1)").ok, false);
  assert.equal(normalizeCanonicalOrigin("data:text/html,x").ok, false);
  assert.equal(normalizeCanonicalOrigin("file:///etc/passwd").ok, false);
  assert.equal(normalizeCanonicalOrigin("ftp://example.com").ok, false);
});

test("normalizeCanonicalOrigin HARDENING — trailing DNS dot is rejected", () => {
  assert.equal(normalizeCanonicalOrigin("https://madaf-drab.vercel.app.").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://example.com./").ok, false);
});

test("normalizeCanonicalOrigin HARDENING — any backslash is rejected", () => {
  assert.equal(normalizeCanonicalOrigin("https://example.com\\").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://example.com\\@evil.com").ok, false);
  assert.equal(normalizeCanonicalOrigin("https://a\\b.com").ok, false);
});

test("normalizeCanonicalOrigin HARDENING — whitespace/control fail fast (no trim)", () => {
  assert.equal(normalizeCanonicalOrigin(" https://example.com").ok, false); // leading
  assert.equal(normalizeCanonicalOrigin("https://example.com ").ok, false); // trailing
  assert.equal(normalizeCanonicalOrigin("https://exa mple.com").ok, false); // embedded space
  assert.equal(normalizeCanonicalOrigin("https://exa\tmple.com").ok, false); // tab
  assert.equal(normalizeCanonicalOrigin("https://exämple.com").ok, false); // non-ASCII
  assert.equal(reasonOf(normalizeCanonicalOrigin("")), "missing");
  assert.equal(reasonOf(normalizeCanonicalOrigin(undefined)), "missing");
  assert.equal(normalizeCanonicalOrigin("   ").ok, false); // all-whitespace = invalid, not missing
});

// ── 2. resolveConfiguredOrigin — precedence + conflict ─────────────────────
test("APP_URL is primary; SITE_URL used only when APP is absent", () => {
  assert.equal(okOrigin(resolveConfiguredOrigin(CANON, undefined)), CANON);
  assert.equal(okOrigin(resolveConfiguredOrigin(undefined, CANON)), CANON);
});

test("an INVALID primary fails (never falls through to the secondary)", () => {
  const r = resolveConfiguredOrigin("https://bad url/path", CANON);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("a whitespace-only primary is PRESENT (invalid), not treated as absent", () => {
  const r = resolveConfiguredOrigin("   ", CANON);
  assert.equal(r.ok, false);
  assert.equal(r.ok === false && r.reason, "invalid");
});

test("two valid-but-different origins conflict; identical succeed", () => {
  const conflict = resolveConfiguredOrigin(CANON, "https://other.example");
  assert.equal(conflict.ok === false && conflict.reason, "conflict");
  assert.equal(okOrigin(resolveConfiguredOrigin(CANON, "https://madaf-drab.vercel.app/")), CANON);
  assert.equal(reasonOf(resolveConfiguredOrigin(undefined, undefined)), "missing");
});

// ── 3. isLoopbackOrigin — loopback ONLY ────────────────────────────────────
test("isLoopbackOrigin accepts real loopback and rejects the rest", () => {
  for (const o of ["http://localhost", "https://localhost", "http://127.0.0.1:3000", "http://0.0.0.0:8080", "http://[::1]:3000"]) {
    assert.equal(isLoopbackOrigin(o), true, o);
  }
  for (const o of ["http://warehouse.local", "http://localhost.evil.example", "http://192.168.1.10:3000", "ftp://localhost"]) {
    assert.equal(isLoopbackOrigin(o), false, o);
  }
});

// ── 4. hostnameOf — normalized, terminal-dot stripped ──────────────────────
test("hostnameOf strips a terminal DNS dot and lower-cases (for comparison)", () => {
  assert.equal(hostnameOf("madaf-drab.vercel.app"), "madaf-drab.vercel.app");
  assert.equal(hostnameOf("madaf-drab.vercel.app."), "madaf-drab.vercel.app");
  assert.equal(hostnameOf("https://MADAF-drab.vercel.app./"), "madaf-drab.vercel.app");
  assert.equal(hostnameOf("evil\\.com"), null); // backslash rejected
  assert.equal(hostnameOf(""), null);
  assert.equal(hostnameOf(undefined), null);
});

// ── 5. isValidPublicToken — base64url, 43 chars ────────────────────────────
test("isValidPublicToken accepts the generator format and rejects the rest", () => {
  assert.equal(isValidPublicToken(TOKEN), true);
  assert.equal(isValidPublicToken(TOKEN + "x"), false);
  for (const bad of ["/", "\\", ".", "%", "?", " "]) {
    assert.equal(isValidPublicToken(TOKEN.slice(0, 42) + bad), false, bad);
  }
  assert.equal(isValidPublicToken(""), false);
});

// ── 6. isRejectedVercelHost — SHARED preview-host contract ─────────────────
test("isRejectedVercelHost rejects per-deploy / per-branch / non-prod *.vercel.app", () => {
  // equals VERCEL_URL (per-deploy) → rejected
  assert.equal(isRejectedVercelHost(CANON, { url: "madaf-drab.vercel.app" }), true);
  // equals VERCEL_BRANCH_URL → rejected
  assert.equal(isRejectedVercelHost(CANON, { branchUrl: "madaf-drab.vercel.app" }), true);
  // trailing-dot metadata still matches (cannot bypass)
  assert.equal(isRejectedVercelHost(CANON, { url: "madaf-drab.vercel.app." }), true);
  // a *.vercel.app host with NO production alias → rejected (fail safe)
  assert.equal(isRejectedVercelHost(CANON, {}), true);
  // a *.vercel.app host that is NOT the production alias → rejected
  assert.equal(isRejectedVercelHost(CANON, { productionUrl: "other-prod.vercel.app" }), true);
});

test("isRejectedVercelHost allows the production alias and custom domains", () => {
  // *.vercel.app canonical == production alias, distinct per-deploy host → allowed
  assert.equal(
    isRejectedVercelHost(CANON, { url: "madaf-abc123.vercel.app", productionUrl: "madaf-drab.vercel.app" }),
    false,
  );
  // custom domain → always allowed (no metadata needed)
  assert.equal(isRejectedVercelHost("https://shop.madaf.example", {}), false);
  assert.equal(isRejectedVercelHost("https://shop.madaf.example", { url: "madaf-abc.vercel.app" }), false);
});

// ── 7. buildPublicTokenUrl — every part validated, per-route ───────────────
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
  assert.equal(buildPublicTokenUrl({ origin: "//preview.vercel.app", locale: "he", routeType: "shop", token: TOKEN }).ok, false);
  const badLocale = buildPublicTokenUrl({ origin: CANON, locale: "ARABIC", routeType: "shop", token: TOKEN });
  assert.equal(badLocale.ok === false && badLocale.reason, "locale");
  for (const bad of [TOKEN.slice(0, 42) + "/", TOKEN.slice(0, 42) + "?", "short"]) {
    const r = buildPublicTokenUrl({ origin: CANON, locale: "he", routeType: "shop", token: bad });
    assert.equal(r.ok === false && r.reason, "token", bad);
  }
});

// ── 8. isDisplayablePublicUrl — EXACT, canonical-authority aware ────────────
test("display guard accepts ONLY the exact canonical link (configured origin)", () => {
  withPublicEnv({ app: CANON }, () => {
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN}`, { locale: "ar", routeType: "shop" }), true);
    // wrong authority / preview authority
    assert.equal(isDisplayablePublicUrl(`https://evil.example/ar/shop/${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`https://madaf-preview-abc.vercel.app/ar/shop/${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    // doubled slash / trailing slash / extra segment
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop//${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN}/`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN}/x`, { locale: "ar", routeType: "shop" }), false);
    // wrong locale / wrong route (manager supplies its own expectation)
    assert.equal(isDisplayablePublicUrl(`${CANON}/he/shop/${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/showcase/${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    // query / hash / encoded ambiguity / backslash / credentials
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN}?x=1`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN}#h`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}/ar/shop/${TOKEN.slice(0, 42)}%2e`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(`${CANON}\\ar\\shop\\${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    // relative / null / non-http
    assert.equal(isDisplayablePublicUrl(`/ar/shop/${TOKEN}`, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl(null, { locale: "ar", routeType: "shop" }), false);
    assert.equal(isDisplayablePublicUrl("javascript:alert(1)", { locale: "ar", routeType: "shop" }), false);
  });
});

test("display guard falls back to LOOPBACK-only when nothing is configured (local dev)", () => {
  withPublicEnv({ app: undefined, site: undefined }, () => {
    assert.equal(isDisplayablePublicUrl(`http://localhost:3000/he/join/${TOKEN}`, { locale: "he", routeType: "join" }), true);
    // a non-loopback authority is rejected when unconfigured — no preview leak
    assert.equal(isDisplayablePublicUrl(`https://madaf-preview.vercel.app/he/join/${TOKEN}`, { locale: "he", routeType: "join" }), false);
  });
});

test("clientCanonicalOrigin reads the build-time public env", () => {
  withPublicEnv({ app: CANON }, () => assert.equal(okOrigin(clientCanonicalOrigin()), CANON));
  withPublicEnv({ app: undefined, site: undefined }, () => assert.equal(clientCanonicalOrigin().ok, false));
});

// ── 9. createCanonicalLink — MUTATION ORDERING + reason categories ─────────
test("createCanonicalLink: origin failure → config, mutation NOT run", async () => {
  const persist = mock.fn(async () => {});
  const result = await createCanonicalLink({
    locale: "he",
    routeType: "shop",
    resolveOrigin: async () => ({ ok: false, reason: "missing" }) as OriginResult,
    persist,
  });
  assert.equal(result.ok === false && result.reason, "config");
  assert.equal(persist.mock.callCount(), 0);
});

test("createCanonicalLink: invalid part (bad locale) → validation, mutation NOT run", async () => {
  const persist = mock.fn(async () => {});
  const result = await createCanonicalLink({
    locale: "ARABIC",
    routeType: "shop",
    resolveOrigin: async () => ({ ok: true, origin: CANON }),
    persist,
  });
  assert.equal(result.ok === false && result.reason, "validation");
  assert.equal(persist.mock.callCount(), 0);
});

test("createCanonicalLink: a persist throw PROPAGATES (not swallowed as config)", async () => {
  await assert.rejects(
    createCanonicalLink({
      locale: "he",
      routeType: "shop",
      resolveOrigin: async () => ({ ok: true, origin: CANON }),
      persist: async () => {
        throw new Error("customer X is deactivated (inactive)"); // MDF33-style
      },
    }),
    /deactivated/,
  );
});

test("createCanonicalLink: success persists once with a valid token + absolute url", async () => {
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
  assert.ok(isValidPublicToken(link.rawToken));
  assert.equal(link.url, `${CANON}/ar/showcase/${link.rawToken}`);
});

test("createCanonicalLink never logs the raw token", async () => {
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => mock.method(console, m, () => {}));
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
      assert.ok(!call.arguments.map((a) => String(a)).join(" ").includes(token));
    }
  }
});

// ── 10. Error-category mapping (client) ────────────────────────────────────
test("linkErrorMessage maps categories to distinct, safe messages", () => {
  const common = {
    linkUrlError: "CONFIG",
    linkGenerationError: "VALIDATION",
    actionError: "OPERATION",
  } as unknown as Parameters<typeof linkErrorMessage>[0];
  assert.equal(linkErrorMessage(common, "config"), "CONFIG");
  assert.equal(linkErrorMessage(common, "validation"), "VALIDATION");
  assert.equal(linkErrorMessage(common, "persistence"), "OPERATION");
  assert.equal(linkErrorMessage(common, undefined), "OPERATION"); // rejected action → generic op, NOT config
});

test("isInactiveStoreError matches MDF33 / deactivated only", () => {
  assert.equal(isInactiveStoreError(new Error("... MDF33 ...")), true);
  assert.equal(isInactiveStoreError(new Error("customer is deactivated")), true);
  assert.equal(isInactiveStoreError(new Error("network error")), false);
  assert.equal(isInactiveStoreError("not an error"), false);
});

// ── 11. Deployment safety — canonical mandatory for hosted Supabase ────────
const HOSTED_BASE: Record<string, string> = {
  NEXT_PUBLIC_MADAF_DATA_MODE: "supabase",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
};
function assessHosted(extra: Record<string, string | undefined>) {
  return assessDeploymentSafety({ ...HOSTED_BASE, ...extra }, { treatAsDeploy: true });
}

test("hosted deploy with a valid production-alias canonical is OK", () => {
  const r = assessHosted({
    NEXT_PUBLIC_APP_URL: CANON,
    VERCEL_PROJECT_PRODUCTION_URL: "madaf-drab.vercel.app",
    VERCEL_URL: "madaf-abc123.vercel.app",
  });
  assert.equal(r.ok, true, JSON.stringify(r.errors));
});

test("hosted deploy with a valid custom-domain canonical is OK", () => {
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: "https://shop.madaf.example" }).ok, true);
});

test("hosted deploy MISSING / INVALID / LOOPBACK canonical is an ERROR", () => {
  assert.equal(assessHosted({}).ok, false);
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: "https://x.example/path" }).ok, false);
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" }).ok, false);
});

test("hosted deploy with a CONFLICTING app/site is an ERROR", () => {
  const r = assessHosted({ NEXT_PUBLIC_APP_URL: CANON, NEXT_PUBLIC_SITE_URL: "https://other.example", VERCEL_PROJECT_PRODUCTION_URL: "madaf-drab.vercel.app" });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.toLowerCase().includes("different")));
});

test("canonical equal to the per-deploy Vercel host, or a non-prod *.vercel.app, is REJECTED", () => {
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: CANON, VERCEL_URL: "madaf-drab.vercel.app" }).ok, false);
  // *.vercel.app canonical without a matching production alias → rejected
  assert.equal(assessHosted({ NEXT_PUBLIC_APP_URL: CANON }).ok, false);
});

test("local/mock needs no canonical URL", () => {
  assert.equal(assessDeploymentSafety({}, {}).ok, true);
  assert.equal(assessDeploymentSafety({ NEXT_PUBLIC_MADAF_DATA_MODE: "mock" }, {}).ok, true);
});

// ── 12. Vercel deploy REQUIRES data mode === supabase (pass-4) ─────────────
const SB: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-placeholder",
};
const VALID_CANON: Record<string, string> = {
  NEXT_PUBLIC_APP_URL: CANON,
  VERCEL_PROJECT_PRODUCTION_URL: "madaf-drab.vercel.app",
  VERCEL_URL: "madaf-abc123.vercel.app",
};

test("a Vercel deploy WITHOUT data mode === supabase is an ERROR (missing/mock/invalid)", () => {
  assert.equal(assessDeploymentSafety({ VERCEL: "1", ...SB, ...VALID_CANON }, { treatAsDeploy: true }).ok, false); // missing
  assert.equal(assessDeploymentSafety({ VERCEL: "1", NEXT_PUBLIC_MADAF_DATA_MODE: "mock", ...SB, ...VALID_CANON }, { treatAsDeploy: true }).ok, false);
  assert.equal(assessDeploymentSafety({ VERCEL: "1", NEXT_PUBLIC_MADAF_DATA_MODE: "demo", ...SB, ...VALID_CANON }, { treatAsDeploy: true }).ok, false);
  // Detected via VERCEL_ENV too — omitting VERCEL cannot disguise the deploy.
  assert.equal(assessDeploymentSafety({ VERCEL_ENV: "preview", NEXT_PUBLIC_MADAF_DATA_MODE: "mock", ...SB, ...VALID_CANON }, { treatAsDeploy: true }).ok, false);
});

test("Vercel hosted supabase (valid) is OK; local mock + local supabase stay OK", () => {
  assert.equal(assessDeploymentSafety({ VERCEL: "1", NEXT_PUBLIC_MADAF_DATA_MODE: "supabase", ...SB, ...VALID_CANON }, { treatAsDeploy: true }).ok, true);
  assert.equal(assessDeploymentSafety({ NEXT_PUBLIC_MADAF_DATA_MODE: "mock" }, {}).ok, true); // local zero-config
  assert.equal(
    assessDeploymentSafety({ NEXT_PUBLIC_MADAF_DATA_MODE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:55321", NEXT_PUBLIC_SUPABASE_ANON_KEY: "x" }, {}).ok,
    true,
  ); // local supabase dev
});

// ── 13. Display-guard fallback semantics — loopback ONLY on "missing" (pass-4) ─
test("display guard: loopback fallback applies ONLY when canonical config is missing", () => {
  const loopback = `http://localhost:3000/he/shop/${TOKEN}`;
  const exact = `${CANON}/he/shop/${TOKEN}`;
  // genuinely MISSING config + valid localhost → allowed (local dev)
  withPublicEnv({ app: undefined, site: undefined }, () =>
    assert.equal(isDisplayablePublicUrl(loopback, { locale: "he", routeType: "shop" }), true));
  // INVALID app + localhost → fail closed (not treated as local dev)
  withPublicEnv({ app: "https://bad url/x" }, () =>
    assert.equal(isDisplayablePublicUrl(loopback, { locale: "he", routeType: "shop" }), false));
  // CONFLICTING app/site + localhost → fail closed
  withPublicEnv({ app: CANON, site: "https://other.example" }, () =>
    assert.equal(isDisplayablePublicUrl(loopback, { locale: "he", routeType: "shop" }), false));
  // INVALID selected site (app absent) + localhost → fail closed
  withPublicEnv({ app: undefined, site: "javascript:alert(1)" }, () =>
    assert.equal(isDisplayablePublicUrl(loopback, { locale: "he", routeType: "shop" }), false));
  // valid canonical + exact canonical URL → pass
  withPublicEnv({ app: CANON }, () =>
    assert.equal(isDisplayablePublicUrl(exact, { locale: "he", routeType: "shop" }), true));
  // valid canonical + loopback URL → fail (loopback is not the configured origin)
  withPublicEnv({ app: CANON }, () =>
    assert.equal(isDisplayablePublicUrl(loopback, { locale: "he", routeType: "shop" }), false));
});
