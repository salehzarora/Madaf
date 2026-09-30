import "server-only";

const events = {
  server_request_unexpected: { severity: "error", operation: "request" },
  document_record_unavailable: { severity: "warning", operation: "document_prepare" },
} as const;

// Exact templates only: never infer a template from a URL, ID, token or query.
const routes = new Set([
  "/api/health", "/api/mobile/devices", "/[locale]", "/[locale]/login",
  "/[locale]/reset-password", "/[locale]/onboarding",
  "/[locale]/shop/[token]", "/[locale]/showcase/[token]",
  "/[locale]/invite/[token]", "/[locale]/join/[token]",
  "/[locale]/catalog", "/[locale]/product/[id]", "/[locale]/cart",
  "/[locale]/checkout", "/[locale]/order-success", "/[locale]/admin",
  "/[locale]/admin/orders", "/[locale]/admin/orders/[id]",
  "/[locale]/admin/orders/[id]/documents/[type]",
  "/[locale]/admin/orders/[id]/documents/[type]/print",
  "/[locale]/admin/products", "/[locale]/admin/products/new",
  "/[locale]/admin/products/[id]/edit", "/[locale]/admin/customers",
  "/[locale]/admin/customers/new", "/[locale]/admin/customers/signup",
  "/[locale]/admin/customers/[id]", "/[locale]/admin/customers/[id]/edit",
  "/[locale]/admin/inventory", "/[locale]/admin/inventory/movements",
  "/[locale]/admin/documents", "/[locale]/admin/documents/[id]",
  "/[locale]/admin/manufacturers", "/[locale]/admin/team",
  "/[locale]/admin/settings/business", "/[locale]/admin/settings/tax",
  "/[locale]/admin/settings/notifications",
]);

function safeRoute(value: unknown): string {
  if (typeof value !== "string" || value.length > 160) return "unknown";
  // Next supplies route-file templates, including route groups / page suffixes.
  const template = value.replace(/\/(page|route|layout)$/, "").replace("/(shop)", "");
  return routes.has(template) ? template : "unknown";
}

/** No arbitrary metadata parameter; output is constructed from an allowlist. */
export function logServerDiagnostic(event: keyof typeof events, routeTemplate?: unknown): void {
  try {
    if (typeof event !== "string" || !Object.hasOwn(events, event)) return;
    const definition = events[event];
    const sha = process.env.VERCEL_GIT_COMMIT_SHA;
    const env = process.env.VERCEL_ENV;
    const runtime = process.env.NEXT_RUNTIME;
    const output = JSON.stringify({
      event,
      severity: definition.severity,
      timestamp: new Date().toISOString(),
      environment: env === "production" || env === "preview" || env === "development"
        ? env : process.env.NODE_ENV === "production" ? "production" : "development",
      runtime: runtime === "nodejs" || runtime === "edge" ? runtime : "unknown",
      commit: sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : "unknown",
      operation: definition.operation,
      route: safeRoute(routeTemplate),
    });
    if (definition.severity === "error") console.error(output);
    else console.warn(output);
  } catch {
    // Diagnostics are best effort. No fallback logging, recursion or retries.
  }
}
