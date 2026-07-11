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
 *  2. RUNTIME preview-host defense (defense in depth, independent of the build
 *     gate): even a configured canonical is REJECTED when it is THIS deploy's
 *     Vercel per-deploy/per-branch host, or any non-production `*.vercel.app`
 *     host — using the SAME `isRejectedVercelHost` contract as the deployment
 *     linter. Vercel metadata is read here (server-only) and never exposed to
 *     the client.
 *  3. Only when NO env is configured, fall back to the request Host — and ONLY
 *     if it is a loopback (local dev). A hosted/preview request host is refused,
 *     so a per-deploy Vercel host can never become a public customer link.
 */
import { headers } from "next/headers";

import {
  isLoopbackOrigin,
  isRejectedVercelHost,
  normalizeCanonicalOrigin,
  resolveConfiguredOrigin,
  type OriginResult,
} from "@/lib/public-url";

/** This deploy's Vercel metadata (server-only). Never sent to the client. */
function vercelDeployMetadata() {
  return {
    url: process.env.VERCEL_URL,
    branchUrl: process.env.VERCEL_BRANCH_URL,
    productionUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL,
  };
}

export async function resolveServerCanonicalOrigin(): Promise<OriginResult> {
  const configured = resolveConfiguredOrigin(
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_SITE_URL,
  );
  if (configured.ok) {
    // Defense in depth: refuse a canonical that is this deploy's per-deploy /
    // per-branch Vercel host, or a non-production *.vercel.app host — even if
    // the build gate was somehow skipped. Preview builds MAY still point links
    // at the stable production alias (that is allowed by the contract).
    if (isRejectedVercelHost(configured.origin, vercelDeployMetadata())) {
      return { ok: false, reason: "invalid" };
    }
    return configured;
  }
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
