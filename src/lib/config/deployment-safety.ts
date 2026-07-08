import "server-only";

/**
 * Deployment safety assessment (M7C) — SERVER-ONLY, PURE, NON-THROWING.
 *
 * A read-only misconfiguration linter for staging/production. It NEVER throws
 * and is NEVER imported at module-eval/build time, so it cannot break the
 * zero-env mock build (mock/local with no env yields no errors). Call it from
 * an ops health check, a one-off script, or a server action to catch obvious
 * dangerous config before/after a deploy. See
 * docs/deployment/STAGING_DEPLOYMENT_M7C.md.
 *
 * It reads env only; it holds no secrets and logs nothing. Callers decide what
 * to do with the report (log, fail a health check, etc.).
 */

export interface DeploymentSafetyReport {
  /** True when there are no blocking errors. Warnings do not affect this. */
  ok: boolean;
  /** Blocking misconfigurations — a deploy with any of these is unsafe. */
  errors: string[];
  /** Non-blocking advisories worth reviewing before launch. */
  warnings: string[];
}

type Env = Record<string, string | undefined>;

/**
 * Substrings that must NEVER appear in a non-allowlisted NEXT_PUBLIC
 * (client-exposed) var name — a secret shipped to the browser is a leak.
 * Deliberately broad (generic `TOKEN`/`OTP`/`CODE`/`KEY` variants + named
 * SMS providers) so near-misses like `NEXT_PUBLIC_API_TOKEN` are caught.
 */
const CLIENT_SECRET_MARKERS = [
  "SERVICE_ROLE",
  "SECRET",
  "TOKEN",
  "OTP",
  "CODE",
  "SMS",
  "PRIVATE",
  "PASSWORD",
  "API_KEY",
  "ACCESS_KEY",
  "AUTH_TOKEN",
  "BEARER",
  "JWT",
  "TWILIO",
  "VONAGE",
  "MESSAGEBIRD",
  "TEXTLOCAL",
  "PROVIDER_KEY",
  "PROVIDER_SECRET",
  "SIGNING",
  "CREDENTIAL",
];

/**
 * The ONLY NEXT_PUBLIC vars Madaf legitimately exposes to the browser. Anything
 * else is treated as suspicious: a secret-shaped name is an error, and any
 * other unknown NEXT_PUBLIC var is a warning (keep the public surface tight).
 */
const ALLOWED_PUBLIC_KEYS = new Set([
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_MADAF_DATA_MODE",
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SITE_URL",
]);

function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])(:\d+)?(\/|$)/i.test(
    url.trim(),
  );
}

/**
 * Assess deployment safety for a given env (defaults to process.env). Pass
 * `treatAsDeploy: true` for staging/production strictness even when NODE_ENV
 * is not "production" (e.g. a preview build you want to gate).
 */
export function assessDeploymentSafety(
  env: Env = process.env,
  { treatAsDeploy }: { treatAsDeploy?: boolean } = {},
): DeploymentSafetyReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const isDeploy = treatAsDeploy || env.NODE_ENV === "production";

  // 1. Keep the NEXT_PUBLIC surface tight. A secret-shaped name is an ERROR
  //    (it would ship a secret to the browser); any other unknown NEXT_PUBLIC
  //    var is a WARNING (should be on the small allowlist).
  for (const key of Object.keys(env)) {
    if (!key.startsWith("NEXT_PUBLIC_")) continue;
    if (ALLOWED_PUBLIC_KEYS.has(key)) continue;
    if (CLIENT_SECRET_MARKERS.some((m) => key.includes(m))) {
      errors.push(
        `${key} is a client-exposed NEXT_PUBLIC var whose name looks secret — remove it (secrets are server-only, never NEXT_PUBLIC).`,
      );
    } else {
      warnings.push(
        `${key} is a NEXT_PUBLIC var not on the known allowlist — confirm it is safe to expose to the browser.`,
      );
    }
  }

  // 2. Legal-invoicing must stay OFF (M6 boundary; never enabled outside review).
  if (env.MADAF_LEGAL_INVOICING_ENABLED === "true") {
    errors.push(
      "MADAF_LEGAL_INVOICING_ENABLED=true — legal invoicing must stay OFF (M6G review gate not satisfied).",
    );
  }
  if (env.MADAF_LEGAL_NUMBERING_ENABLED === "true") {
    errors.push(
      "MADAF_LEGAL_NUMBERING_ENABLED=true — legal numbering must stay OFF.",
    );
  }
  const providerMode = env.MADAF_TAX_PROVIDER_MODE;
  if (providerMode && providerMode !== "disabled" && providerMode !== "sandbox") {
    errors.push(
      `MADAF_TAX_PROVIDER_MODE="${providerMode}" — only "disabled"/"sandbox" are allowed (production is never valid).`,
    );
  }

  // 3. The DEV/MOCK fake-OTP path must never be enabled in a deploy.
  if (isDeploy && env.MADAF_DEV_PHONE_OTP_ENABLED === "true") {
    errors.push(
      "MADAF_DEV_PHONE_OTP_ENABLED=true in a deployment — the fake-OTP path is local/dev only. Unset it.",
    );
  }

  // 4. Supabase config sanity when running the real (supabase) data mode.
  const dataMode = env.NEXT_PUBLIC_MADAF_DATA_MODE;
  if (dataMode === "supabase") {
    if (!env.NEXT_PUBLIC_SUPABASE_URL) {
      errors.push("NEXT_PUBLIC_MADAF_DATA_MODE=supabase but NEXT_PUBLIC_SUPABASE_URL is missing.");
    }
    if (!env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      errors.push("NEXT_PUBLIC_MADAF_DATA_MODE=supabase but NEXT_PUBLIC_SUPABASE_ANON_KEY is missing.");
    }
    if (isDeploy && env.NEXT_PUBLIC_SUPABASE_URL && isLocalUrl(env.NEXT_PUBLIC_SUPABASE_URL)) {
      errors.push(
        "A deployment is pointing NEXT_PUBLIC_SUPABASE_URL at a LOCAL Supabase URL — set the hosted staging URL.",
      );
    }
    if (isDeploy && !env.SUPABASE_SERVICE_ROLE_KEY) {
      warnings.push(
        "SUPABASE_SERVICE_ROLE_KEY is not set — stored document PDFs will fall back to streaming (see storage docs).",
      );
    }
  } else if (isDeploy) {
    warnings.push(
      "NEXT_PUBLIC_MADAF_DATA_MODE is not \"supabase\" in a deployment — the app will run in MOCK/demo mode (no backend, no auth).",
    );
  }

  // 5. Trusted document storage: 'enabled' ALWAYS requires a pinned project ref
  //    (regardless of whether a Supabase URL is present) — it is what stops the
  //    trusted service-role client from ever targeting an arbitrary project.
  if (env.MADAF_TRUSTED_DOCUMENT_STORAGE === "enabled") {
    if (!env.MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF?.trim()) {
      errors.push(
        "MADAF_TRUSTED_DOCUMENT_STORAGE=enabled requires MADAF_TRUSTED_DOCUMENT_STORAGE_PROJECT_REF (non-blank) to pin the target project.",
      );
    }
  }

  // 6. A public app URL is helpful for auth redirects / links.
  if (isDeploy && !env.NEXT_PUBLIC_APP_URL && !env.NEXT_PUBLIC_SITE_URL) {
    warnings.push(
      "No NEXT_PUBLIC_APP_URL / NEXT_PUBLIC_SITE_URL set — confirm Supabase Auth site/redirect URLs match the deployed origin.",
    );
  }

  return { ok: errors.length === 0, errors, warnings };
}
