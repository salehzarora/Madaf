// M8A.4 — dynamic-route guard.
//
// The detail/token routes read per-request auth/token state; if one ever
// becomes statically generated (the Vercel "●" bug — e.g. someone adds
// generateStaticParams or drops force-dynamic), it would serve stale or
// EMPTY data to everyone. This script runs right after `next build` (wired
// into the npm build script) and FAILS the build if a critical route shows
// up in the prerender manifest — i.e. got SSG'd — or vanished entirely
// (renamed without updating the guard).
//
// Signals (from .next/):
//   app-path-routes-manifest.json — every app route that exists.
//   prerender-manifest.json       — routes that were prerendered (SSG):
//     `routes` holds concrete prerendered paths, `dynamicRoutes` holds
//     prerendered dynamic patterns. Critical routes must be in NEITHER.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CRITICAL = [
  "/[locale]/product/[id]",
  "/[locale]/admin/orders/[id]",
  "/[locale]/admin/orders/[id]/documents/[type]",
  "/[locale]/admin/documents/[id]",
  "/[locale]/admin/customers/[id]",
  "/[locale]/admin/customers/[id]/edit",
  "/[locale]/admin/products/[id]/edit",
  "/[locale]/invite/[token]",
  "/[locale]/join/[token]",
  "/[locale]/shop/[token]",
  "/[locale]/showcase/[token]",
];

const nextDir = join(process.cwd(), ".next");
const read = (name) =>
  JSON.parse(readFileSync(join(nextDir, name), "utf8"));

let appPaths, prerender;
try {
  appPaths = read("app-path-routes-manifest.json");
  prerender = read("prerender-manifest.json");
} catch (error) {
  console.error(
    "[check-dynamic-routes] cannot read .next manifests — run `next build` first.",
    error.message,
  );
  process.exit(1);
}

const existing = new Set(Object.values(appPaths));
const prerendered = new Set([
  ...Object.keys(prerender.routes ?? {}),
  ...Object.keys(prerender.dynamicRoutes ?? {}),
]);

const problems = [];
for (const route of CRITICAL) {
  if (!existing.has(route)) {
    problems.push(`MISSING: ${route} no longer exists — renamed? Update scripts/check-dynamic-routes.mjs.`);
  } else if (prerendered.has(route)) {
    problems.push(`SSG: ${route} was statically generated — it must stay dynamic (ƒ). Remove generateStaticParams / restore force-dynamic.`);
  }
}

if (problems.length > 0) {
  console.error("[check-dynamic-routes] FAILED:");
  for (const p of problems) console.error("  - " + p);
  process.exit(1);
}
console.log(
  `[check-dynamic-routes] OK — ${CRITICAL.length} critical routes exist and none are SSG.`,
);
