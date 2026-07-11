/**
 * Server/test-side orchestration for creating a tokenized public link (M8E.2).
 *
 * Generates the raw token, builds + validates the ABSOLUTE canonical URL, and
 * ONLY THEN runs the caller's `persist` mutation. If the canonical URL cannot
 * be produced, the mutation is NEVER invoked — so no token hash is persisted
 * and no existing link is revoked when a usable public URL is unavailable.
 *
 * Failure categories are DISTINCT (M8E.2 review #7):
 *  - `config`     — the canonical ORIGIN could not be resolved (missing /
 *                   invalid / conflicting / preview-host env). UI → "public app
 *                   URL not configured".
 *  - `validation` — the origin resolved but a PART (locale / route / token) was
 *                   invalid when assembling the URL. An internal invariant; UI →
 *                   a safe generic link-generation error.
 * A failure of the `persist` mutation itself is NOT caught here: it PROPAGATES
 * so the caller can categorise it (e.g. deactivated store vs. generic
 * persistence/transport error) rather than mislabel it as a config failure.
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

export type CanonicalLinkReason = "config" | "validation";
export type CanonicalLinkResult =
  | { ok: true; url: string }
  | { ok: false; reason: CanonicalLinkReason };

export async function createCanonicalLink(input: {
  locale: string;
  routeType: PublicRouteType;
  /** Resolve the canonical origin (env → loopback fallback). Injected so the
   * ordering can be tested without `next/headers`. */
  resolveOrigin: () => Promise<OriginResult>;
  /** The mutation (revoke/insert). Invoked ONLY after the URL is validated. A
   * throw here PROPAGATES (not caught) so the caller can categorise it. */
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
  if (!link.ok) return { ok: false, reason: "validation" };

  await input.persist({ rawToken, url: link.url });
  return { ok: true, url: link.url };
}
