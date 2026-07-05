# Madaf / מדף · مدف

**A B2B supplier catalog & ordering platform for local goods suppliers.**
Sales reps open the catalog on a tablet inside the shop; owners browse,
pick package quantities and send a clean order request — instead of
WhatsApp photo albums.

> **Phase M0 — design foundation.** Everything here is a polished,
> trilingual mock: no backend, no auth, no payments, and **no legal tax
> invoices** (drafts only). See [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md).

## Quick start

```bash
npm install
npm run dev        # → http://localhost:3000  (redirects to /he)
```

Other commands: `npm run build` (production build), `npm run start`
(serve build), `npm run lint`.

Requirements: Node 20+ (developed on Node 22), npm.

## Try the demo

| Screen | URL |
|---|---|
| Landing (Hebrew) | `/he` — also `/ar`, `/en` |
| Catalog + filters + sticky cart | `/he/catalog` |
| Sales-visit flow (preselected shop) | `/he/catalog?customer=c02` |
| Product detail | `/he/product/p01` |
| Cart → order request → success | `/he/cart` → checkout → success |
| Admin dashboard | `/he/admin` |
| Orders + status pipeline | `/he/admin/orders` → open one |
| Inventory (low stock, expiry) | `/he/admin/inventory` |
| Shops | `/he/admin/customers` |
| Documents (Hebrew-first previews) | `/he/admin/documents` |
| Invoice DRAFT with watermark | `/he/admin/documents/doc-1043-i` |

Languages: use the switcher in the header — עברית / العربية / English.
Hebrew & Arabic render fully RTL; documents default to Hebrew with their
own language toggle.

## Tech

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4
(design tokens in `src/app/globals.css`) · lucide-react icons ·
Rubik font (one variable font for Latin+Hebrew+Arabic) ·
hand-rolled shadcn-style UI primitives (no runtime UI deps).

## Documentation

| Doc | Contents |
|---|---|
| [docs/PRODUCT_BRIEF.md](docs/PRODUCT_BRIEF.md) | what Madaf is, users, brand |
| [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md) | phase boundaries, mock-only list |
| [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) | tokens, components, rules |
| [docs/USER_FLOWS.md](docs/USER_FLOWS.md) | sales-visit, remote, admin flows |
| [docs/INFORMATION_ARCHITECTURE.md](docs/INFORMATION_ARCHITECTURE.md) | routes, folders, data model |
| [docs/I18N_RTL_GUIDE.md](docs/I18N_RTL_GUIDE.md) | locales, RTL rules, formatting |
| [docs/DOCUMENTS_AND_INVOICES_GUIDE.md](docs/DOCUMENTS_AND_INVOICES_GUIDE.md) | legal wording & invoice safety |
| [docs/FUTURE_BACKEND_HANDOFF.md](docs/FUTURE_BACKEND_HANDOFF.md) | Supabase plan for the next agent |
| [CLAUDE.md](CLAUDE.md) | rules for AI agents working here |

## Manual test checklist

1. `/` redirects to `/he`; `<html>` has correct `lang`/`dir` per locale.
2. Catalog: search "cola"/"קולה"/"كولا", toggle category & manufacturer
   chips, clear filters; empty state appears for nonsense queries.
3. Add products → sticky cart bar appears with package count + subtotal.
4. Pick a shop ("ordering for") → visible on catalog; survives reload.
5. Cart: change quantities, remove items; checkout prefills shop details.
6. Send order request → success screen with order number; cart is empty.
7. Admin dashboard numbers match mock data; recent orders clickable.
8. Order detail: move status along the pipeline (resets on reload — demo).
9. Inventory: low-stock filter; expiry column only for dairy items.
10. Documents: open an invoice draft → DRAFT watermark + legal notice;
    switch document language he/ar/en; print preview hides app chrome.
11. Repeat a spot-check of 2–4 in Arabic and English.

## License / status

Internal design-phase prototype. Mock data only — brand names appear as
realistic placeholder catalog content for a demo.
