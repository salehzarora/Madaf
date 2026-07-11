import "server-only";

/**
 * SERVER-SIDE canonical origin resolution for public token links (M8E.2).
 *
 * Called by the link server actions BEFORE any token mutation, so a missing or
 * misconfigured canonical URL fails fast — no token hash is persisted and no
 * existing link is revoked when a usable public URL cannot be produced.
 *
 * Resolution:
 *  1. Configured env — `NEXT_PUBLIC_APP_URL` (primary), `NEXT_PUBLIC_SITE_URL`
 *     (fallback). An invalid primary or a conflicting pair is a HARD error
 *     (never a silent fall-through). This is the hosted source of truth.
 *  2. Only when NO env is configured, fall back to the request Host — and ONLY
 *     if it is a loopback (local dev). A hosted/preview request host is refused,
 *     so a per-deploy Vercel host can never become a public customer link.
 */
import { headers } from "next/headers";

import {
  isLoopbackOrigin,
  normalizeCanonicalOrigin,
  resolveConfiguredOrigin,
  type OriginResult,
} from "@/lib/public-url";

export async function resolveServerCanonicalOrigin(): Promise<OriginResult> {
  const configured = resolveConfiguredOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  if (configured.ok) return configured;
  // A present-but-invalid / conflicting env is a real error — never fall back.
  if (configured.reason !== "missing") return configured;

  // No canonical env configured: accept the request host ONLY if it is a real
  // loopback dev origin. Anything else (a hosted/preview host) is refused.
  let host: string | null = null;
  try {
    host = (await headers()).get("host");
  } catch {
    host = null;
  }
  if (!host) return { ok: false, reason: "missing" };
  const candidate = normalizeCanonicalOrigin(`http://${host}`);
  if (candidate.ok && isLoopbackOrigin(candidate.origin)) return candidate;
  return { ok: false, reason: "missing" };
}
