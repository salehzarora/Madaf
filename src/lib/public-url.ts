/**
 * Canonical public URL contract for TOKENIZED customer links (M8E.2).
 *
 * PURE + dependency-light (only the i18n locale source of truth). No
 * `server-only`, no `window`, no request/header reads. The ONLY env it reads
 * is the build-time-inlined, NON-SECRET public origin (`NEXT_PUBLIC_APP_URL` /
 * `NEXT_PUBLIC_SITE_URL`) via `clientCanonicalOrigin()` — safe in the client
 * bundle. Secret env + request headers + Vercel runtime metadata live in
 * `public-url-server.ts` and `deployment-safety.ts`. This module is the single
 * validator used by the server actions (which build the absolute link BEFORE
 * any token mutation), the deployment-safety linter/gate, the client display
 * guard, and the tests.
 *
 * WHY it exists: shop / showcase / store-signup / team-invite links are opened
 * by people who are NOT the warehouse owner (and NOT logged into Vercel).
 * Building them from the current browser/deploy origin leaked a per-deploy
 * Vercel PREVIEW host — gated by Deployment Protection — so recipients were
 * bounced to the Vercel login. All public links must come from ONE configured
 * canonical origin, validated here.
 *
 * STRICT contract (fail-fast, never silently repair): a canonical origin must
 * be an absolute http(s) URL with no userinfo, query, fragment, or path beyond
 * an empty root, no backslash, no leading/trailing/embedded whitespace or
 * control chars, no non-ASCII, and no terminal DNS dot. The SOLE normalization
 * is dropping a single trailing root slash.
 */
import { isLocale, type Locale } from "@/i18n/config";

/** The public route families that carry a raw one-time token in their path. */
export const PUBLIC_ROUTE_TYPES = ["shop", "showcase", "join", "invite"] as const;
export type PublicRouteType = (typeof PUBLIC_ROUTE_TYPES)[number];

export function isPublicRouteType(value: unknown): value is PublicRouteType {
  return (
    typeof value === "string" &&
    (PUBLIC_ROUTE_TYPES as readonly string[]).includes(value)
  );
}

/**
 * The link token is `randomBytes(32).toString("base64url")` (all four actions):
 * exactly 43 chars from the base64url alphabet, no padding. Anything else — a
 * slash, backslash, dot, `%`, `?`, `#`, whitespace, control char, wrong length
 * — is rejected, so a malformed/ambiguous path segment can never be built.
 */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
export function isValidPublicToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export type OriginErrorReason = "missing" | "invalid" | "conflict";
export type OriginResult =
  | { ok: true; origin: string }
  | { ok: false; reason: OriginErrorReason };

/** True if the string contains only printable-ASCII characters (0x21–0x7E) —
 * no control chars, no spaces/whitespace, no DEL, and no deceptive non-ASCII
 * (homograph) characters. A canonical origin is always printable ASCII. */
function isPrintableAscii(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

/**
 * Extract a NORMALIZED hostname for comparison (preview-host detection).
 * Accepts a bare host or a URL. Lower-cased, with a single terminal DNS dot
 * stripped so `host.` and `host` compare equal — a trailing-dot value can
 * never bypass the preview-host check. Returns null on anything unparseable or
 * containing a backslash / whitespace / control char.
 */
export function hostnameOf(value: string | undefined | null): string | null {
  if (typeof value !== "string" || value === "") return null;
  if (value.includes("\\")) return null;
  if (!isPrintableAscii(value)) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  let host: string;
  try {
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  // Strip a single terminal DNS dot for comparison (see doc above).
  if (host.endsWith(".")) host = host.slice(0, -1);
  return host === "" ? null : host;
}

/**
 * Strict canonical-origin contract. Accepts ONLY an absolute http(s) URL with:
 * no userinfo, no query, no fragment, no path beyond an empty root (`/`), no
 * backslash, no leading/trailing/embedded whitespace or control chars, no
 * non-ASCII, and no terminal DNS dot on the host. On success, returns the
 * ORIGIN only (scheme + host + non-default port) — the sole normalization is
 * dropping the root slash. It NEVER silently trims or strips: any deviation is
 * a hard rejection.
 */
export function normalizeCanonicalOrigin(
  raw: string | undefined | null,
): OriginResult {
  if (typeof raw !== "string") return { ok: false, reason: "missing" };
  if (raw === "") return { ok: false, reason: "missing" };
  // Do NOT trim — leading/trailing whitespace is a malformed value, not
  // something to silently repair. isPrintableAscii also rejects embedded
  // whitespace, control chars, and non-ASCII.
  if (!isPrintableAscii(raw)) return { ok: false, reason: "invalid" };
  // Reject backslashes BEFORE WHATWG parsing: the parser rewrites `\` to `/`
  // in http(s) URLs, which can silently split host/path (e.g. `https://a\b.com`
  // parses to host `a`). Refuse the whole value instead.
  if (raw.includes("\\")) return { ok: false, reason: "invalid" };
  // Require an EXPLICIT http(s) scheme — this also rejects protocol-relative
  // (`//host`), scheme-relative, and dangerous schemes before parsing.
  if (!/^https?:\/\//i.test(raw)) return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "invalid" };
  }
  if (url.username || url.password) return { ok: false, reason: "invalid" }; // no credentials
  if (url.search) return { ok: false, reason: "invalid" }; // no query
  if (url.hash) return { ok: false, reason: "invalid" }; // no fragment
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, reason: "invalid" }; // no path beyond root
  }
  if (url.hostname.endsWith(".")) {
    return { ok: false, reason: "invalid" }; // no terminal DNS dot
  }
  return { ok: true, origin: url.origin };
}

/**
 * Is this a real loopback (local development) origin? The ONLY origins we ever
 * accept from a request/browser when no canonical URL is configured. Matches
 * the URL-parser hostname forms exactly: `localhost`, `127.0.0.1`, `0.0.0.0`,
 * and IPv6 loopback `[::1]`. Deliberately NOT `*.local`, LAN/mDNS, or
 * localhost-lookalikes (`localhost.evil.example`), and only http(s).
 */
export function isLoopbackOrigin(origin: string): boolean {
  const normalized = normalizeCanonicalOrigin(origin);
  if (!normalized.ok) return false;
  let host: string;
  try {
    host = new URL(normalized.origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1"
  );
}

/**
 * Resolve the configured canonical origin with strict precedence:
 *  - `NEXT_PUBLIC_APP_URL` is primary. If present but INVALID → error (never
 *    silently fall through to the secondary).
 *  - `NEXT_PUBLIC_SITE_URL` is used only when the primary is ABSENT; if selected
 *    and invalid → error.
 *  - If both are present and normalize to DIFFERENT origins → `conflict`.
 *  - If neither is present → `missing`.
 *
 * "Present" means a non-empty string. A whitespace-only value is PRESENT (and
 * therefore validated → rejected as invalid), not treated as absent — a
 * malformed primary must never silently fall through to the secondary.
 */
export function resolveConfiguredOrigin(
  appUrl: string | undefined | null,
  siteUrl: string | undefined | null,
): OriginResult {
  const hasApp = typeof appUrl === "string" && appUrl !== "";
  const hasSite = typeof siteUrl === "string" && siteUrl !== "";

  if (hasApp) {
    const primary = normalizeCanonicalOrigin(appUrl);
    if (!primary.ok) return { ok: false, reason: "invalid" };
    if (hasSite) {
      const secondary = normalizeCanonicalOrigin(siteUrl);
      // Only a VALID-but-different secondary is a conflict; an invalid
      // secondary is irrelevant because it is not selected.
      if (secondary.ok && secondary.origin !== primary.origin) {
        return { ok: false, reason: "conflict" };
      }
    }
    return primary;
  }
  if (hasSite) {
    const secondary = normalizeCanonicalOrigin(siteUrl);
    if (!secondary.ok) return { ok: false, reason: "invalid" };
    return secondary;
  }
  return { ok: false, reason: "missing" };
}

/**
 * SHARED preview-host contract (used by BOTH the deployment-safety linter/gate
 * and the server-only runtime resolver, so they agree exactly). Given a valid
 * canonical origin and the current deploy's Vercel metadata, returns true when
 * the canonical must be REJECTED because it is a per-deploy/preview host:
 *  - equal to this deploy's `VERCEL_URL` (per-deploy host), or
 *  - equal to `VERCEL_BRANCH_URL` (per-branch host), or
 *  - any other `*.vercel.app` host that is NOT the stable
 *    `VERCEL_PROJECT_PRODUCTION_URL` alias.
 * A custom (non-`.vercel.app`) canonical domain is always allowed. All
 * comparisons go through `hostnameOf` (lower-cased, terminal-dot-stripped), so
 * a trailing-dot metadata value cannot slip a preview host past the check.
 */
export function isRejectedVercelHost(
  canonicalOrigin: string,
  vercel: {
    url?: string | null;
    branchUrl?: string | null;
    productionUrl?: string | null;
  },
): boolean {
  const host = hostnameOf(canonicalOrigin);
  if (!host) return false; // unparseable origins are rejected upstream
  const perDeploy = hostnameOf(vercel.url);
  const perBranch = hostnameOf(vercel.branchUrl);
  if (perDeploy && host === perDeploy) return true;
  if (perBranch && host === perBranch) return true;
  if (host.endsWith(".vercel.app")) {
    const production = hostnameOf(vercel.productionUrl);
    // A *.vercel.app canonical is allowed ONLY when it is the stable production
    // alias; an unknown/absent production alias means reject (fail safe).
    if (!production || host !== production) return true;
  }
  return false;
}

/**
 * Resolve the client-visible expected canonical origin from the build-time
 * inlined, NON-SECRET public env vars. Used ONLY by the client display guard to
 * assert the server-built link uses the configured origin. Reads no secrets and
 * no Vercel metadata.
 */
export function clientCanonicalOrigin(): OriginResult {
  return resolveConfiguredOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  );
}

export type BuildErrorReason = "origin" | "locale" | "route" | "token";
export type BuildResult =
  | { ok: true; url: string }
  | { ok: false; reason: BuildErrorReason };

/**
 * Build a validated absolute public token URL from parts. Every part is
 * checked: `origin` must satisfy the canonical contract, `locale` must be a
 * supported locale (the i18n source of truth), `routeType` one of the four
 * public families, and `token` a valid link token. The token is used verbatim.
 * Callers pass their OWN route type, so a shop flow cannot emit a showcase/
 * join/invite path. Returns a hard error (no partial/misleading URL) on any
 * invalid part.
 */
export function buildPublicTokenUrl(input: {
  origin: string;
  locale: string;
  routeType: PublicRouteType;
  token: string;
}): BuildResult {
  const origin = normalizeCanonicalOrigin(input.origin);
  if (!origin.ok) return { ok: false, reason: "origin" };
  if (!isLocale(input.locale)) return { ok: false, reason: "locale" };
  if (!isPublicRouteType(input.routeType)) return { ok: false, reason: "route" };
  if (!isValidPublicToken(input.token)) return { ok: false, reason: "token" };
  const locale: Locale = input.locale;
  return {
    ok: true,
    url: `${origin.origin}/${locale}/${input.routeType}/${input.token}`,
  };
}

/**
 * EXACT client-side display guard: a URL is safe to show/copy only if it is the
 * exact canonical token link the caller expects. The manager supplies its OWN
 * `locale` and `routeType`, and the expected origin is the configured canonical
 * (or, when unconfigured — local dev — a loopback origin only). The check is an
 * EXACT string match against `${origin}/<locale>/<routeType>/<token>`, so a
 * doubled slash, trailing slash, extra segment, query, fragment, credentials,
 * backslash, wrong locale, wrong route type, or a preview/unrelated authority
 * are ALL rejected — a shop manager can never display a showcase/invite/join
 * URL, and the client never accepts a preview host merely because the path
 * looks token-shaped. The server already builds + validates the link; this is
 * defense in depth so a copy control can NEVER expose anything else.
 */
export function isDisplayablePublicUrl(
  value: unknown,
  expected: { locale: Locale; routeType: PublicRouteType },
): value is string {
  if (typeof value !== "string" || value === "") return false;
  if (value.includes("\\")) return false;
  if (!isPrintableAscii(value)) return false; // no whitespace/control/non-ASCII
  // Determine the expected authority: the configured canonical origin, or (only
  // when nothing is configured, i.e. local dev) a loopback origin.
  let expectedOrigin: string;
  const configured = clientCanonicalOrigin();
  if (configured.ok) {
    expectedOrigin = configured.origin;
  } else {
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return false;
    }
    if (!isLoopbackOrigin(parsed.origin)) return false;
    expectedOrigin = parsed.origin;
  }
  // Exact-match the whole value: prefix is the canonical origin + locale +
  // route; the remainder must be a single valid token (no further `/`, query,
  // fragment, dot-segment, or encoded char survives isValidPublicToken).
  const prefix = `${expectedOrigin}/${expected.locale}/${expected.routeType}/`;
  if (!value.startsWith(prefix)) return false;
  const token = value.slice(prefix.length);
  return isValidPublicToken(token);
}
