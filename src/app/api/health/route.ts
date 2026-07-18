/**
 * Minimal application liveness endpoint (M8I.7) — GET /api/health.
 *
 * PURPOSE: let a monitored-Pilot operator answer "is Production reachable, and
 * WHICH commit is live?" without opening the app. It is APPLICATION liveness only
 * — it performs NO database access, NO business-row read, NO service_role call,
 * and exposes NO configuration, project ref, env values, secrets, or stack traces.
 *
 * SAFE FIELDS ONLY: a fixed status, the service name, the short deployed commit
 * SHA (validated, from the server-only Vercel Git env var; "unknown" fallback),
 * a coarse environment label, and a runtime timestamp. Never cached.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Validate + shorten the Vercel-provided commit SHA to a bounded 7-hex value. */
function deployedCommit(): string {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  if (typeof sha === "string" && /^[0-9a-f]{7,40}$/i.test(sha)) {
    return sha.slice(0, 7).toLowerCase();
  }
  return "unknown";
}

/** Coarse environment label — never the raw env, never a URL/ref/secret. */
function environmentLabel(): "production" | "preview" | "development" {
  const env = process.env.VERCEL_ENV;
  if (env === "production" || env === "preview" || env === "development") return env;
  return process.env.NODE_ENV === "production" ? "production" : "development";
}

const NO_STORE = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
} as const;

function payload() {
  return {
    status: "ok" as const,
    service: "madaf",
    commit: deployedCommit(),
    environment: environmentLabel(),
    timestamp: new Date().toISOString(),
  };
}

export function GET(): Response {
  return new Response(JSON.stringify(payload()), { status: 200, headers: NO_STORE });
}

export function HEAD(): Response {
  return new Response(null, { status: 200, headers: NO_STORE });
}
