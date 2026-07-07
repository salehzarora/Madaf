# Madaf / מדף · مدف

**A B2B supplier catalog & ordering platform for local goods suppliers.**
Sales reps open the catalog on a tablet inside the shop; owners browse,
pick package quantities and send a clean order request — instead of
WhatsApp photo albums.

> **Phase M6D — sandbox/mock provider adapter.** A server-only legal-invoice
> provider abstraction (`src/lib/legal-invoicing/provider/`) with a
> **NullProvider** (disabled) and a **SandboxProvider** (deterministic mock,
> every response marked non-legal), selected by `MADAF_TAX_PROVIDER_MODE`
> (`disabled`|`sandbox`; **`production` is clamped to `disabled`**). **No real
> tax-authority integration, no allocation number, no credentials, no production
> mode, no payments, no legal PDF** — it changes no document, attaches no
> `legal_number`, sets no `issued` status, and is wired to no UI/route (dormant).
> M6E adds real (sandbox-first, flag-gated) issuing after a professional review.
> Built on:
>
> **Phase M6C — disabled legal numbering skeleton.** A `draw_legal_document_number`
> RPC (owner/admin, atomic) that draws an **internal, non-legal preview**
> (`DRAFT-LEGAL-YYYY-######`), **fail-closed behind two default-OFF gates** (a
> service-role-only DB kill switch + the `MADAF_LEGAL_NUMBERING_ENABLED` env flag
> gating a dormant, unwired helper). **Issues nothing** — no tax invoice, no
> allocation number (מספר הקצאה), no provider, no payment, no legal PDF, no
> `legal_number` on documents — and no UI/route draws numbers. (M6C.1 hardened
> input validation: year must be `2000..2100`, and legal-entity scoping is
> rejected until modeled — invalid calls draw nothing and write no row.) Needs a
> professional tax/accounting/legal review before real issuing (M6D-M6G). Built on:
>
> **Phase M6B — inert legal-invoicing foundation.** Per-tenant **tax settings**
> (owner/admin, at `/admin/settings/tax`), a server-only **feature-flag reader**
> (three flags, all default OFF/`disabled`, fail-closed, never `NEXT_PUBLIC`),
> and an **inert legal schema** (8 RLS-locked tables + enums, **no issuing/
> numbering RPC, no provider call, no route, no bucket**). **Nothing is issued:**
> no legal tax invoice, no allocation number (מספר הקצאה), no tax-authority/
> provider call, no legal number, no payments — and no draft "not a tax invoice"
> warning is removed. Saving tax settings issues nothing (the page says so in
> he/ar/en). Needs a professional tax/accounting/legal review + official-source
> verification before any real issuing (M6C-M6G). Built on:
>
> **Phase M5B — stored PDFs & signed URLs** (hardened in **M5B.1**).
> Generated document PDFs are now stored in a **private** Supabase Storage
> bucket and served via short-lived, access-checked **signed URLs** (no public
> URLs). The admin order-detail page lists per-type document history (status ·
> number · date) with **download** and **regenerate**. Access is verified by
> the server route (RLS `can_access_order` + validated RPCs): owner/admin any
> order, a sales_rep only assigned-customer orders, cross-tenant/anon blocked.
> M5B.1 locks uploads/overwrites to a **trusted server-only path** — normal
> users cannot write to the documents bucket directly. Hebrew/Arabic PDF
> spacing is much improved. **Still drafts only — no legal tax invoices, no
> tax-authority integration, no legal numbering, no payments.** Built on:
>
> **Phase M5A — documents & PDF foundation.** Admins download real
> server-generated PDFs for the three safe document types — **order request,
> delivery note, and invoice DRAFT** — from the order-detail page
> (`/admin/orders/[id]`). PDFs render from order snapshots (Hebrew-first,
> `?lang=` for ar/he/en); invoice drafts always carry a DRAFT watermark +
> "not a tax invoice" notice, and every PDF footer says so. **Still no legal
> tax invoices, no tax-authority integration, no legal numbering** — drafts
> only. Generation is gated exactly like order reads (owner/admin any order,
> a sales_rep only assigned-customer orders) via the `create_order_document`
> RPC; documents stay RPC-only writes. Built on the M4 access-control
> foundation below.
>
> **Phase M4D — access-control enforcement.** The UI is the polished
> trilingual M0 design (no payments, and **no legal tax invoices** — drafts
> only; see [docs/MVP_SCOPE.md](docs/MVP_SCOPE.md)). Building on **M4C**
> multi-tenant switching, **M4D** ENFORCES **sales_rep customer scoping**: a
> sales rep sees only the customers assigned to them and can create orders
> only for an assigned customer (owner/admin see and order for all) —
> enforced at the DB via `can_access_customer` in the customers RLS policy
> and `create_order_request`. It also adds **owner transfer**
> (`promote_tenant_owner` / `demote_tenant_owner`, last-owner-protected) and
> a **stronger anonymous-token rate limiter** (a global per-purpose counter
> that never blocks valid tokens; the raw token is never stored). Owner/admin
> manage rep assignments + ownership on `/admin/team`. Customers still order
> with no login via tokenized `/shop/<token>` links; direct table writes stay
> RPC-only. **Mock stays the zero-config default** — no auth, open demo
> admin. Documents/invoices are M5/M6. See
> [docs/AUTH_AND_ACCESS_MODEL.md](docs/AUTH_AND_ACCESS_MODEL.md).

## Quick start

```bash
npm install
npm run dev        # → http://localhost:3000  (redirects to /he)
```

Other commands: `npm run build` (production build), `npm run start`
(serve build), `npm run lint`.

Requirements: Node 20+ (developed on Node 22), npm.
The app runs in **mock mode** by default — no database or env vars needed.

### Optional: Supabase mode with real auth (M4A, local dev only)

```bash
supabase start     # needs Docker + Supabase CLI — see supabase/README.md
supabase db reset  # re-apply migrations + demo seed
docker exec -i supabase_db_Madaf psql -U postgres -d postgres \
  < supabase/bootstrap-auth.sql          # create the demo auth users
cp .env.example .env.local
# in .env.local: set NEXT_PUBLIC_MADAF_DATA_MODE=supabase
# (NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY come pre-filled)
npm run dev        # sign in at /he/login as owner@madaf.local / madaf-demo-1234
```

Reads are server-side only (RSC) under RLS; **all writes go through Server
Actions → tenant-validated DB functions** gated by `authorize_tenant`
(the client-submitted `tenant_id` is never trusted). Anonymous visitors
see no supplier data (the catalog is not public); customers reach a
tenant-scoped catalog only through a private link token, and place orders
via an anon RPC that prices everything server-side. No Supabase key beyond
the public anon key reaches the browser, and the session lives in httpOnly
cookies. RLS stays deny-by-default (only ever tightened), and the mode
refuses to run in production or against a non-local Supabase URL. Full
model: [docs/AUTH_AND_ACCESS_MODEL.md](docs/AUTH_AND_ACCESS_MODEL.md).

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
| Download order/delivery/invoice-draft PDF | order detail → Documents card, or `/he/admin/orders/o1043/documents/invoiceDraft` |

Languages: use the switcher in the header — עברית / العربية / English.
Hebrew & Arabic render fully RTL; documents default to Hebrew with their
own language toggle.

## Tech

Next.js 16 (App Router, Turbopack) · TypeScript · Tailwind CSS v4
(design tokens in `src/app/globals.css`) · lucide-react icons ·
Rubik font (one variable font for Latin+Hebrew+Arabic) ·
pdfkit + a vendored OFL Rubik TTF for server-side document PDFs
(`src/lib/pdf/`, Node runtime, no Chromium) ·
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
| [docs/LEGAL_INVOICING_ARCHITECTURE.md](docs/LEGAL_INVOICING_ARCHITECTURE.md) | M6 legal-invoicing plan (**design only — nothing issued**) |
| [docs/AUTH_AND_ACCESS_MODEL.md](docs/AUTH_AND_ACCESS_MODEL.md) | auth, roles, RLS, tenant links (M4A) |
| [docs/FUTURE_BACKEND_HANDOFF.md](docs/FUTURE_BACKEND_HANDOFF.md) | Supabase plan for the next agent |
| [docs/security/AUDIT_NOTES.md](docs/security/AUDIT_NOTES.md) | `npm audit` status & handling |
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
11. Order detail → Documents card → Download PDF (order / delivery /
    invoice draft): a PDF downloads; the invoice draft shows the DRAFT
    watermark + "not a tax invoice" notice; the delivery note has no prices.
12. Repeat a spot-check of 2–4 in Arabic and English.

## License / status

Internal design-phase prototype. Mock data only — brand names appear as
realistic placeholder catalog content for a demo.
