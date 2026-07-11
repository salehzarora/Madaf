/**
 * Server/test-side orchestration for creating a tokenized public link (M8E.2).
 *
 * Generates the raw token, builds + validates the ABSOLUTE canonical URL, and
 * ONLY THEN runs the caller's `persist` mutation. If the canonical URL cannot
 * be produced (missing/invalid/conflicting config, or an invalid part), the
 * mutation is NEVER invoked — so no token hash is persisted and no existing
 * link is revoked when a usable public URL is unavailable.
 *
 * Imports only `node:crypto` + the pure validator (no `next/*`, no data layer),
 * so both dependencies are injected and the ordering is unit-testable. Not
 * imported by any client component.
 */
import { randomBytes } from "node:crypto";

import {
  buildPublicTokenUrl,
  type OriginResult,
  type PublicRouteType,
} from "@/lib/public-url";

export type CanonicalLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: "config" };

export async function createCanonicalLink(input: {
  locale: string;
  routeType: PublicRouteType;
  /** Resolve the canonical origin (env → loopback fallback). Injected so the
   * ordering can be tested without `next/headers`. */
  resolveOrigin: () => Promise<OriginResult>;
  /** The mutation (revoke/insert). Invoked ONLY after the URL is validated. */
  persist: (link: { rawToken: string; url: string }) => Promise<void>;
}): Promise<CanonicalLinkResult> {
  const origin = await input.resolveOrigin();
  if (!origin.ok) return { ok: false, reason: "config" };

  const rawToken = randomBytes(32).toString("base64url");
  const link = buildPublicTokenUrl({
    origin: origin.origin,
    locale: input.locale,
    routeType: input.routeType,
    token: rawToken,
  });
  if (!link.ok) return { ok: false, reason: "config" };

  await input.persist({ rawToken, url: link.url });
  return { ok: true, url: link.url };
}
