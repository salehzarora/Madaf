/**
 * Canonical public application URL for TOKENIZED customer links (M8E.2).
 *
 * WHY: private shop, showcase, store-signup and team-invite links are copied
 * out of the admin and opened by people who are NOT the warehouse owner (and
 * NOT logged into Vercel). Building those absolute URLs from the current
 * browser origin (`window.location.origin`) leaks whatever host the admin
 * happened to be on — a Vercel PREVIEW deployment (e.g.
 * `madaf-...-<team>.vercel.app`) is gated by Vercel Deployment Protection, so
 * the recipient is bounced to the Vercel login. The fix: always build these
 * links from ONE configured canonical origin.
 *
 * Client-safe (no `server-only`) — used by the client link-manager components.
 * Reads the build-time-inlined `NEXT_PUBLIC_APP_URL` (falling back to
 * `NEXT_PUBLIC_SITE_URL`, the pair the deployment safety linter already knows
 * about). It NEVER silently falls back to a non-local request origin: in a
 * hosted deployment without the env configured it returns null so the caller
 * shows a clear error instead of a broken/preview link.
 */

/** The public route families that carry a raw one-time token in their path. */
export type PublicRouteType = "shop" | "showcase" | "join" | "invite";

/**
 * Parse + normalize a configured origin: require an absolute http(s) URL and
 * reduce it to the ORIGIN only (drops any path/query/hash and the trailing
 * slash). Returns null for blank/relative/malformed/non-http values.
 */
export function normalizeOrigin(raw: string | undefined | null): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // `URL.origin` is already normalized: scheme + host (+ non-default port),
  // no path, no query, no hash, no trailing slash.
  return parsed.origin;
}

/** A localhost-family origin is the ONLY request origin we ever trust as a
 * fallback (local dev / `next dev`) — never a hosted/preview host. */
function isLocalOrigin(origin: string): boolean {
  let host: string;
  try {
    host = new URL(origin).hostname;
  } catch {
    return false;
  }
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "[::1]" ||
    host === "::1" ||
    host.endsWith(".local")
  );
}

export interface CanonicalOrigin {
  /** The canonical origin, or null when none can be safely determined. */
  origin: string | null;
  /** Present only when null: why the origin is unavailable. */
  reason?: "unconfigured-hosted" | "no-window";
}

/**
 * Resolve the canonical public origin:
 *  1. `NEXT_PUBLIC_APP_URL` (or `NEXT_PUBLIC_SITE_URL`) when configured — the
 *     hosted source of truth, used on production AND preview builds so a copied
 *     link is always the public URL.
 *  2. Otherwise, ONLY on a localhost request origin (local dev / mock), fall
 *     back to the current window origin.
 *  3. Otherwise null (`unconfigured-hosted`) — a hosted deploy missing the env:
 *     the caller must fail clearly, never emit a preview-host link.
 */
export function canonicalOrigin(): CanonicalOrigin {
  const configured =
    normalizeOrigin(process.env.NEXT_PUBLIC_APP_URL) ??
    normalizeOrigin(process.env.NEXT_PUBLIC_SITE_URL);
  if (configured) return { origin: configured };

  if (typeof window !== "undefined") {
    const current = window.location.origin;
    if (isLocalOrigin(current)) return { origin: current };
    // Hosted (non-local) origin with no configured canonical URL — refuse to
    // leak it (this is exactly the preview-host bug).
    return { origin: null, reason: "unconfigured-hosted" };
  }
  return { origin: null, reason: "no-window" };
}

/**
 * Turn a RELATIVE app path (e.g. `/ar/shop/<token>` produced server-side) into
 * an absolute canonical URL. Preserves the path (locale + route + token) EXACTLY
 * — the origin is the only thing prepended. Returns null when no safe canonical
 * origin is available. The raw token is never logged here.
 */
export function absolutePublicUrl(relativePath: string): string | null {
  const { origin } = canonicalOrigin();
  if (!origin) return null;
  const path = relativePath.startsWith("/") ? relativePath : `/${relativePath}`;
  return `${origin}${path}`;
}

/**
 * Build a canonical tokenized public URL from its parts. `locale` must be a
 * 2-letter code; `token` is used verbatim (never transformed/logged). Returns
 * null on invalid parts or when no canonical origin is available.
 */
export function buildPublicTokenUrl(input: {
  locale: string;
  routeType: PublicRouteType;
  token: string;
}): string | null {
  const locale =
    typeof input.locale === "string" && /^[a-z]{2}$/.test(input.locale)
      ? input.locale
      : null;
  if (!locale) return null;
  if (typeof input.token !== "string" || input.token.length === 0) return null;
  return absolutePublicUrl(`/${locale}/${input.routeType}/${input.token}`);
}
