/**
 * Canonical public URL contract for TOKENIZED customer links (M8E.2).
 *
 * PURE + dependency-light (only the i18n locale source of truth). No
 * `server-only`, no `window`, no env/header reads — those live in
 * `public-url-server.ts` and `deployment-safety.ts`. This module is the single
 * validator used by the server actions (which build the absolute link BEFORE
 * any token mutation), the deployment-safety linter, and the tests.
 *
 * WHY it exists: shop / showcase / store-signup / team-invite links are opened
 * by people who are NOT the warehouse owner (and NOT logged into Vercel).
 * Building them from the current browser/deploy origin leaked a per-deploy
 * Vercel PREVIEW host — gated by Deployment Protection — so recipients were
 * bounced to the Vercel login. All public links must come from ONE configured
 * canonical origin, validated here.
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

/** Extract a hostname for comparison (e.g. Vercel preview detection). Accepts a
 * bare host or a URL; returns null on anything unparseable. */
export function hostnameOf(value: string | undefined | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
}

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
 * Strict canonical-origin contract. Accepts ONLY an absolute http(s) URL with:
 * no userinfo, no query, no fragment, and no path beyond an empty root (`/`).
 * Rejects protocol-relative forms, non-http(s) schemes (javascript:/data:/
 * file:/ftp:/…), control characters, whitespace, and non-ASCII. On success,
 * returns the ORIGIN only (scheme + host + non-default port) — the sole
 * normalization is dropping the root slash. It never silently strips an
 * unexpected path/query/hash: their presence is a hard rejection.
 */
export function normalizeCanonicalOrigin(
  raw: string | undefined | null,
): OriginResult {
  if (typeof raw !== "string") return { ok: false, reason: "missing" };
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, reason: "missing" };
  // No control chars, whitespace, or non-ASCII anywhere in the value.
  if (!isPrintableAscii(trimmed)) return { ok: false, reason: "invalid" };
  // Require an EXPLICIT http(s) scheme — this also rejects protocol-relative
  // (`//host`), scheme-relative, and dangerous schemes before parsing.
  if (!/^https?:\/\//i.test(trimmed)) return { ok: false, reason: "invalid" };
  let url: URL;
  try {
    url = new URL(trimmed);
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
 */
export function resolveConfiguredOrigin(
  appUrl: string | undefined | null,
  siteUrl: string | undefined | null,
): OriginResult {
  const hasApp = typeof appUrl === "string" && appUrl.trim() !== "";
  const hasSite = typeof siteUrl === "string" && siteUrl.trim() !== "";

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
 * Client-side display guard: a URL is safe to show/copy only if it is an
 * absolute http(s) URL to a supported `/<locale>/<routeType>/<token>` path
 * (no credentials/query/fragment). The server already builds + validates the
 * link; this is a belt-and-suspenders check so a copy control can NEVER expose
 * a null, relative, malformed, or otherwise unexpected value.
 */
export function isDisplayablePublicUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^https?:\/\//.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.search || url.hash) return false;
  const segments = url.pathname.split("/").filter((s) => s.length > 0);
  if (segments.length !== 3) return false;
  const [locale, routeType, token] = segments;
  return isLocale(locale) && isPublicRouteType(routeType) && isValidPublicToken(token);
}
