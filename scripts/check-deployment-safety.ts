// M8E.2 — deployment-safety BUILD GATE.
//
// Runs the read-only deployment-safety assessment against the ACTUAL current
// build environment and FAILS the build (exit 1) when it finds a blocking
// misconfiguration — so a hosted Supabase deploy can never ship with a missing,
// malformed, conflicting, loopback, or per-deploy-preview canonical public URL
// (which would bounce link recipients to the Vercel login). Wired into the real
// build path (`npm run build`), BEFORE `next build`.
//
// SAFE BY DESIGN: reads env only, prints only NON-SECRET diagnostics (env var
// NAMES and safe reasons — never values, tokens, or keys). Zero-config local /
// mock builds stay green: the canonical requirement only triggers for a hosted
// Supabase deploy (NEXT_PUBLIC_MADAF_DATA_MODE=supabase in a deploy context).
//
// Run via: tsx --conditions=react-server scripts/check-deployment-safety.ts
// (the react-server condition makes the `server-only` import in
// deployment-safety.ts a no-op outside a client bundle).
import { assessDeploymentSafety } from "../src/lib/config/deployment-safety";

// A real deploy build: Vercel sets VERCEL=1 for every build; `next build`
// itself runs with NODE_ENV=production. Either signal means "apply hosted
// strictness". Locally (`npm run build` with neither set) this is false, so a
// zero-config mock build is never gated on a canonical URL.
const treatAsDeploy =
  process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

const report = assessDeploymentSafety(process.env, { treatAsDeploy });

for (const warning of report.warnings) {
  console.warn(`[deploy-safety] warn: ${warning}`);
}
for (const problem of report.errors) {
  console.error(`[deploy-safety] ERROR: ${problem}`);
}

const context = treatAsDeploy ? "deploy" : "local/non-deploy";
if (!report.ok) {
  console.error(
    `[deploy-safety] FAILED (${context}) — ${report.errors.length} blocking issue(s). Refusing to build.`,
  );
  process.exit(1);
}
console.log(
  `[deploy-safety] OK — ${context} context; ${report.warnings.length} warning(s), 0 blocking issues.`,
);
