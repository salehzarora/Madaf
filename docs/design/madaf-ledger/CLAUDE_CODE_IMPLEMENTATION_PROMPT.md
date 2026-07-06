# Claude Code — implementation prompt (paste verbatim)

---

You are implementing the **"Madaf Ledger" sitewide visual redesign** in the Madaf Next.js repo.
This is a **visual/frontend-only** task driven entirely by the specs in `docs/design/madaf-ledger/`.
Read them ALL before writing code, in this order:

1. `docs/design/madaf-ledger/README.md` (direction + guardrails)
2. `docs/design/madaf-ledger/DESIGN_TOKENS.md`
3. `docs/design/madaf-ledger/COMPONENT_GUIDE.md`
4. `docs/design/madaf-ledger/SCREEN_IMPLEMENTATION_PLAN.md`
5. `docs/design/madaf-ledger/PASS2_DASHBOARD_CATALOG_SPEC.md` (supersedes Pass 1 for dashboard + catalog)
6. `docs/design/madaf-ledger/I18N_KEYS.md`
7. `docs/design/madaf-ledger/QA_CHECKLIST.md`

Also honor the repo's own rules: `CLAUDE.md`, `docs/DESIGN_SYSTEM.md` (you are updating it — see below),
`docs/I18N_RTL_GUIDE.md`, `docs/DOCUMENTS_AND_INVOICES_GUIDE.md`.

## Git preparation (do this first)

```bash
git fetch origin
git checkout main
git pull --ff-only origin main
git status
git log --oneline -20
```

Then create or switch to the branch:

```bash
git checkout design/sitewide-visual-refresh 2>/dev/null || git checkout -b design/sitewide-visual-refresh
```

If the branch already existed: merge latest main only if it merges cleanly; if conflicts
appear, **STOP and report**. Verify with `git status` and `git log --oneline -20`.

## Hard guardrails — violating any of these means STOP and report

- NO database migrations; nothing under `supabase/` changes.
- NO RLS / RPC / auth / tenant / security changes — do not modify logic in `src/lib/auth/`,
  `src/lib/actions/`, `src/lib/data/`, `src/lib/supabase/`. (Reading them is fine.)
- NO legal invoice issuing UI, NO tax-provider integration, NO payment UI.
- KEEP every invoice-draft / "not a tax invoice" warning, DRAFT watermark, and legal
  disclaimer — text and presence unchanged in all three languages.
- KEEP mock mode as the zero-config default; keep every existing route working.
- KEEP all existing i18n keys; NEW keys only per `I18N_KEYS.md` (add to
  `src/i18n/types.ts` first, then all three dictionaries).
- NO new UI/chart libraries. Charts are HTML/CSS + inline SVG per the Pass 2 spec.
  The only font addition is IBM Plex Mono via `next/font/google`.
- Use ONLY logical CSS properties (`ms/me/ps/pe/start/end/inset-inline/text-start`);
  directional icons get `rtl:-scale-x-100`; every Latin identifier gets `dir="ltr"`
  (including composite strings like "7 / 10" and chart day labels).
- All colors via the semantic tokens from `DESIGN_TOKENS.md` — no raw hex in components,
  EXCEPT the category-dot map and manufacturer-tile brand colors, which are the deliberate
  exceptions defined in the specs (keep them centralized in `category-style.ts` /
  a small `manufacturer-style.ts`).
- Do NOT merge into main. Do NOT push until the final step below.

## Work order

Follow `SCREEN_IMPLEMENTATION_PLAN.md` phases 0–9 exactly. After EVERY phase:
`npm run lint && npm run build`, and spot-check `/he`, `/ar`, `/en` and `/he/admin`.
For the dashboard and catalog, implement the **Pass 2** versions directly (do not build
the Pass 1 dashboard/catalog first).

Also update `docs/DESIGN_SYSTEM.md` to describe the new tokens/components (shelf rule,
band, ticket badges, mono identifiers, KPI/chart components, category dots replacing
gradient art) so the doc matches the code.

If the work becomes too large or risky, prioritize: tokens + primitives + shells +
catalog + dashboard + orders (list/detail). Finish those completely rather than leaving
half-changed pages, and report what remains as "Design Pass 3".

## Verification (before committing)

Run everything in `docs/design/madaf-ledger/QA_CHECKLIST.md`, including the guardrail greps.
All boxes must pass.

## Commit & push

```bash
git status
git add src/ docs/   # only design/frontend/docs files — verify the list before adding
git commit -m "style: redesign Madaf visual system and interfaces"
git push -u origin design/sitewide-visual-refresh
```

Do NOT merge into main. Do NOT open a PR against main unless asked.

## Final report (required)

1. Summary · 2. Current branch · 3. Git prep status · 4. Files changed ·
5. Design direction implemented · 6. Design-system/components changed ·
7. Public/customer pages changed · 8. Admin pages changed · 9. RTL/i18n notes ·
10. Responsive notes · 11. Accessibility notes · 12. Intentionally not changed ·
13. Verification results (lint/build/smoke/greps) · 14. Guardrail confirmation ·
15. Known limitations / suggested Design Pass 3 · 16. `git log --oneline -10` ·
17. Push result.

---
