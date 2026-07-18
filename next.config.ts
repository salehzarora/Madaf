import type { NextConfig } from "next";
// HTTP security headers + CSP (M8I.7) live in a pure, env-parameterized module so
// they can be unit-tested (dev vs production, with/without a Supabase origin)
// independently of build-time NODE_ENV. See src/lib/config/security-headers.ts.
import { securityHeaders } from "./src/lib/config/security-headers";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile exists in the user home dir
  // and would otherwise be inferred as the workspace root.
  turbopack: {
    root: __dirname,
  },
  // HTTP security headers on every route (HSTS is left to Vercel's platform
  // management on *.vercel.app / custom domains — not duplicated here).
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders() }];
  },
  // M5A PDF generation (src/lib/pdf): keep pdfkit/fontkit as external Node
  // packages so their fs-based font/AFM reads keep working (bundling breaks
  // them), and make sure the vendored OFL Rubik TTFs ship with the document
  // download route in a traced/standalone build.
  serverExternalPackages: ["pdfkit", "fontkit"],
  outputFileTracingIncludes: {
    "/[locale]/admin/orders/[id]/documents/[type]": [
      "./src/lib/pdf/fonts/*.ttf",
    ],
  },
  experimental: {
    // Image/logo uploads go through Server Actions, whose request body is
    // capped at 1MB by default — smaller than the app's own image limits
    // (5MB product images, 2MB logos). A valid image between 1MB and the app
    // limit would otherwise be rejected at the transport layer (a rejected
    // action promise), so raise the cap to cover the largest allowed upload.
    serverActions: {
      bodySizeLimit: "6mb",
    },
  },
};

export default nextConfig;
