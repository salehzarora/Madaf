/**
 * HTTP security headers + Content-Security-Policy (M8I.7).
 *
 * Pure and env-parameterized so next.config.ts can apply the headers on every
 * route AND tests can assert both the development and production shapes without
 * mutating process.env. next.config.ts calls `securityHeaders()` with no args, so
 * production/URL are read from the environment at build time; tests pass explicit
 * options.
 *
 * The ONLY cross-origin the browser needs is the app's OWN hosted Supabase
 * project (Auth + PostgREST over https, Realtime over wss, and private
 * product-image signed URLs — all on the same Supabase host). That origin is
 * derived from NEXT_PUBLIC_SUPABASE_URL; in mock/local (no env) the policy is
 * self-only. No wildcard, no "all https", and no secret is embedded (the URL is
 * already a public value). `unsafe-inline` is required for script/style because
 * Next 16's App Router emits inline bootstrap/hydration + streaming scripts and
 * inline styles with no nonce support in this config — this is NOT a nonce CSP.
 * `unsafe-eval` is allowed ONLY in development (React Refresh / Turbopack HMR) and
 * NEVER in production.
 */

export interface CspOptions {
  /** Production build? Defaults to NODE_ENV === "production". */
  production?: boolean;
  /** The app's own hosted Supabase URL. Defaults to NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | null;
}

export interface SecurityHeader {
  key: string;
  value: string;
}

/** Derive the app's Supabase http(s) origin and matching ws(s) origin, or nulls
 * when there is no (valid http/https) URL — e.g. mock/local with no env. */
export function supabaseOrigins(
  supabaseUrl?: string | null,
): { http: string | null; ws: string | null } {
  if (!supabaseUrl) return { http: null, ws: null };
  try {
    const u = new URL(supabaseUrl);
    if (u.protocol !== "https:" && u.protocol !== "http:") return { http: null, ws: null };
    const http = u.origin;
    const ws = `${u.protocol === "https:" ? "wss" : "ws"}://${u.host}`;
    return { http, ws };
  } catch {
    return { http: null, ws: null };
  }
}

export function contentSecurityPolicy(opts: CspOptions = {}): string {
  const production = opts.production ?? process.env.NODE_ENV === "production";
  const supabaseUrl =
    opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  const { http, ws } = supabaseOrigins(supabaseUrl);
  const connect = ["'self'", http, ws].filter(Boolean).join(" ");
  const img = ["'self'", "data:", "blob:", http].filter(Boolean).join(" ");
  // Dev needs 'unsafe-eval' for React Refresh / Turbopack HMR only; production
  // never does.
  const script = production
    ? "'self' 'unsafe-inline'"
    : "'self' 'unsafe-inline' 'unsafe-eval'";
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${script}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src ${img}`,
    "font-src 'self' data:",
    `connect-src ${connect}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
  ].join("; ");
}

/** The full header set applied to every route. HSTS is intentionally omitted —
 * it is managed by Vercel's platform on *.vercel.app / custom domains. */
export function securityHeaders(opts: CspOptions = {}): SecurityHeader[] {
  return [
    { key: "Content-Security-Policy", value: contentSecurityPolicy(opts) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: "DENY" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    },
  ];
}
