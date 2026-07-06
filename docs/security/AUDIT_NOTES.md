# Dependency Audit Notes

Tracks `npm audit` findings and how they were handled. Policy: never run
`npm audit fix --force` (it would downgrade the framework / break the build);
apply only safe, targeted, same-major fixes, otherwise track as non-blocking.

**Current status: `npm audit` → 0 vulnerabilities** (prod and dev).

Verify:

```bash
npm install
npm audit --omit=dev --audit-level=moderate   # → found 0 vulnerabilities
npm audit                                      # → found 0 vulnerabilities
npm run build                                  # → still green
```

## Resolved

### postcss `< 8.5.10` — moderate — GHSA-qx2v-qp2m-jg93 (M5C)

- **Advisory:** "PostCSS has XSS via Unescaped `</style>` in its CSS Stringify
  Output." Affects PostCSS `< 8.5.10`.
- **Where:** transitive only — **`next/node_modules/postcss@8.4.31`** (Next
  16.2.10 bundles its own PostCSS for build-time CSS transforms). The other
  PostCSS in the tree, under `@tailwindcss/postcss`, was already `8.5.16`.
- **Practical risk here:** low/none — PostCSS only processes the app's OWN
  Tailwind/`globals.css` at **build time**; Madaf never stringifies
  untrusted/user-supplied CSS at runtime. Still worth clearing.
- **`npm audit fix --force` was NOT used:** its "fix" was `next@9.3.3` — a
  Next 16 → 9 **downgrade** (breaking, forbidden by the M5C scope).
- **Safe fix applied:** a targeted `overrides` in `package.json` pins PostCSS
  to `^8.5.10` (same major `8.x`, API-compatible), so Next's nested PostCSS
  resolves to `8.5.16` (deduped with the Tailwind one). **No Next
  downgrade, no other dependency changes, build stays green.**

  ```jsonc
  // package.json
  "overrides": { "postcss": "^8.5.10" }
  ```
- **Follow-up:** once a stable Next release ships bundling PostCSS `≥ 8.5.10`,
  the override can be dropped. Re-check on each Next upgrade.

## Tracked (non-blocking)

_None at present._
