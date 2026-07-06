# Madaf Ledger — Design Handoff (Pass 1 + Pass 2)

**Target:** implement the "Madaf Ledger" visual redesign inside the real Next.js project.
**Branch:** `design/sitewide-visual-refresh` · **Commit:** `style: redesign Madaf visual system and interfaces`
**Scope:** visual/frontend ONLY.

## The direction in one paragraph

A wholesale supplier's paper ledger, digitized. Warm paper canvas (`#F2EFE7`), a deep
**bottle-green navigation band** (`#12312A`) — dark chrome belongs to navigation only, content
stays light — **amber** (`#E8A33D`) as the single operational accent (active-nav marker, counts,
draft/legal warnings, sales-visit CTA), and **IBM Plex Mono** for every Latin identifier
(order numbers, SKUs, document numbers, warehouse slots). Status badges are squared
"tickets" with a square dot. Section headers carry a double **shelf-edge rule**
(2px ink + 1px hairline). Product art becomes neutral photo placeholders + a small
category color dot. Kills: generic-blue SaaS, over-dark dashboards, pill-badge sameness,
restaurant/POS vibes.

## Files in this package

| File | Contents |
|---|---|
| `DESIGN_TOKENS.md` | Full `@theme` replacement for `src/app/globals.css`, fonts, motifs |
| `COMPONENT_GUIDE.md` | Component-by-component restyle notes with Tailwind classes |
| `SCREEN_IMPLEMENTATION_PLAN.md` | Page-by-page plan + implementation order |
| `PASS2_DASHBOARD_CATALOG_SPEC.md` | Dashboard v2 (charts) + Catalog v2 (command bar, tiles, price bar) |
| `I18N_KEYS.md` | New dictionary keys (he/ar/en) |
| `QA_CHECKLIST.md` | Verification + guardrail greps |
| `CLAUDE_CODE_IMPLEMENTATION_PROMPT.md` | The exact prompt to run Claude Code with |

## Visual references (design project mocks)

Pass 1: `Redesign — Foundations / Catalog / Admin Dashboard / Orders / Products / Documents / Team & Auth` (.dc.html).
Pass 2 (supersedes Pass 1 for these two screens): `Redesign v2 — Admin Dashboard`, `Redesign v2 — Catalog`, chosen from `Pass 2 — Explorations` (options 1c + 1e).
Baseline recreations of today's UI: `Current UI — *` files. All mocks are trilingual (he/ar/en via the locale tweak); Hebrew is the primary reference.

## Hard guardrails (non-negotiable)

- **No DB migrations.** No changes under `supabase/`.
- **No RLS / RPC / auth / security changes.** Do not touch `src/lib/auth/`, `src/lib/actions/*` logic, `src/lib/data/*` behavior, or any permission gating.
- **No legal invoice issuing UI, no tax-provider integration, no payment UI.**
- **Keep every invoice-draft / "not a tax invoice" warning, watermark, and disclaimer** — wording and presence unchanged (see `docs/DOCUMENTS_AND_INVOICES_GUIDE.md` in the repo).
- **Keep mock mode working with zero env vars**; keep all routes functional; keep `npm run build` and `npm run lint` green.
- **Never remove i18n keys or translations**; new keys go into all three dictionaries (typed via `src/i18n/types.ts`).
- **No new UI libraries.** Charts are plain HTML/CSS + inline SVG (see PASS2 spec). Only new dependency-ish change: loading IBM Plex Mono via `next/font/google`.
- **Do not merge into main. Never push without being asked** (repo CLAUDE.md rule) — the implementation prompt handles branch/commit/push explicitly.
