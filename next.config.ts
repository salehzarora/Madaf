import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile exists in the user home dir
  // and would otherwise be inferred as the workspace root.
  turbopack: {
    root: __dirname,
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
};

export default nextConfig;
