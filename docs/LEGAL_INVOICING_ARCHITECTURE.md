# Legal Invoicing Architecture (M6A design · M6B inert foundation)

> # ⚠️ STILL NO LEGAL TAX INVOICE IS ISSUED
>
> **M6B status (implemented, INERT):** M6B landed the *first foundation* only —
> per-tenant **tax settings** (`tenant_tax_settings` + owner/admin `get`/`upsert`
> RPCs), a server-only **feature-flag reader** (`src/lib/config/legal-invoicing.ts`;
> all default OFF/`disabled`, fail-closed, never `NEXT_PUBLIC`), an **inert legal
> schema** (`legal_documents`/`legal_document_items`/`legal_invoice_sequences`/
> `legal_document_events`/`tax_authority_requests`/`tax_authority_responses`/
> `archival_records`/`signing_records` — RLS + grants locked, **no issuing RPC,
> no numbering RPC, no provider call, no route, no bucket**), and a minimal
> owner/admin **tax-settings page** (`/admin/settings/tax`) that says, in all
> three languages, that nothing is issued. **What M6B does NOT do:** issue a tax
> invoice, request/verify an allocation number (מספר הקצאה), call any tax
> authority/provider, assign any legal number, add payments, or remove any draft
> "not a tax invoice" warning. `tenant_tax_settings.legal_invoicing_ready` and the
> feature flags do **not** enable issuing — there is no issuing code. The M5
> `invoice_draft` stays a DRAFT with its watermark + notice intact. Real issuing
> is M6C–M6G, gated + reviewed. **Re-verify official Israel Tax Authority rules
> and get a professional tax/accounting/legal review before M6C/M6D/M6E.**
>
> - **M6A is an architecture spike.** No code, schema, routes, numbering,
>   provider calls, or payments were added *by M6A*. This document is the *plan*
>   M6B began implementing (inert).
> - **Madaf does NOT issue legal tax invoices today** and is **not legally
>   compliant** for invoicing. Everything the app produces today is a
>   **DRAFT / internal document** — see
>   [DOCUMENTS_AND_INVOICES_GUIDE.md](DOCUMENTS_AND_INVOICES_GUIDE.md). The
>   existing `invoice_draft` stays a draft; its DRAFT watermark and
>   "not a tax invoice" notices are **not** removed by M6A.
> - **This is NOT legal, tax, or accounting advice.** Israeli invoicing law is
>   jurisdiction-sensitive and changes over time. Every requirement below is a
>   *placeholder to be verified* against **official Israel Tax Authority
>   (רשות המסים) sources** and reviewed by a **qualified Israeli
>   accountant / tax advisor / legal counsel** before ANY production use.
> - **No legal issuing path may be enabled by default.** All flags below
>   default OFF / disabled and must **fail closed**.

---

## 0. Purpose & scope

Design a **safe, incremental** path to real Israeli legal tax invoicing so
that a future implementation (M6B+) can be built without rearchitecting, and
so reviewers can see the plan before any risky code lands. M6A delivers: the
legal-boundary rules, a proposed data model, a state machine, a numbering
strategy, a feature-flag model, a provider-adapter abstraction, a legal-PDF
strategy, a security/RLS plan, a phased migration plan, a risk register, and
an implementation checklist.

Out of scope for M6A (explicitly deferred): any migration, any RPC, any
route, any provider SDK/dependency, any real or "test-in-prod" legal number,
any payment, any removal of draft warnings.

---

## A. Research / source notes (VERIFY BEFORE IMPLEMENTING)

Israel is moving to a **real-time invoice clearance / allocation-number**
model ("**חשבוניות ישראל**" / *Invoices Israel*). At a high level (to be
re-confirmed against official sources — do **not** treat these as current):

- For tax invoices **above a value threshold**, the issuer must obtain an
  **allocation number** (**מספר הקצאה**) from the Tax Authority, typically in
  **real time via an API**, and print it on the invoice. Without a valid
  allocation number, the **buyer cannot deduct input VAT** for that invoice.
- The **threshold is being phased down** over multiple years, so the value
  that triggers the requirement, and the timeline, **must be verified for the
  relevant tax year** — do not hard-code it.
- Access to the clearance API generally requires **registration as a
  "software house" / API client** and authenticated, certified integration
  (commonly via **שע"ם / SHAAM**), or via a **certified invoicing provider**
  that wraps it.
- Invoices carry mandatory content (issuer legal name + **ח.פ / עוסק**
  number, VAT registration type, buyer details, VAT breakdown, immutable
  invoice number, issue date, allocation number where required, etc.).

**Official-source placeholders (confirm the exact live URLs at build time):**

| Topic | Where to verify (official) |
|---|---|
| Israel Tax Authority (רשות המסים) portal | `https://www.gov.il/he/departments/israel_tax_authority` |
| "חשבוניות ישראל" / allocation number (מספר הקצאה) program | Tax Authority "חשבוניות ישראל" program page (gov.il) |
| Software-house / API registration + clearance API spec | Tax Authority developer / שע"ם (SHAAM) integration docs |
| Invoice verification (checking an allocation number) | Tax Authority invoice-verification service |
| Certified invoicing provider(s) | The chosen provider's official API documentation |

> These are **pointers, not quotations.** Do not copy long official text into
> the repo. The implementing agent (M6B+) must open the live pages, capture
> the **current** thresholds, fields, and API contracts, and have them
> **reviewed by a tax/accounting professional**.

---

## C. Document-type boundary (existing vs future) — READ FIRST

The single most important rule: **legal documents are a NEW, separate family
from the existing M5 draft documents. The existing draft types are never
renamed or promoted into legal documents.**

| Family | Types | Status | Numbering | Warnings |
|---|---|---|---|---|
| **M5 drafts (today)** | `order_request`, `delivery_note`, `invoice_draft` | Shipped, **DRAFT/internal only** | Internal `DOC-####-x` (not legal) | DRAFT watermark + "not a tax invoice" — **kept** |
| **Future legal (M6+)** | `tax_invoice`, *(later, if needed)* `tax_invoice_receipt`, `credit_note`, `cancellation` | **Design only — none exist** | Immutable legal sequence (§F) | Real legal document (only when truly issued) |

Rules:

- `invoice_draft` **remains a draft** forever in its current form. A legal
  `tax_invoice` is a **different** record produced by a **different** issuing
  flow behind feature flags; it does not mutate the draft.
- The draft's DRAFT watermark, `docs.notLegalNotice`, and the
  "not a tax invoice" footer **must not be removed** until real legal issuing
  is implemented, reviewed, and enabled per-tenant (M6E+).
- The DB enum extension for legal types (`tax_invoice`, `credit_note`, …) is
  **proposed only** (§B) and must arrive with the issuing machinery, not
  before — an enum value with no safe issuing path is a foot-gun.

---

## B. Proposed legal-invoice domain model (NOT A MIGRATION)

All tables are **tenant-scoped** (`tenant_id`), **deny-by-default RLS**, and
**write-locked behind SECURITY DEFINER RPCs** exactly like the current schema
(`docs/AUTH_AND_ACCESS_MODEL.md`). Issued rows are **append-only /
immutable**: corrections happen through a **credit/cancellation document**,
never by mutating an issued row. The sketches below are illustrative — column
names/types must be finalized in M6B against verified requirements.

```sql
-- ⚠️ PROPOSED SCHEMA — NOT A MIGRATION, DO NOT APPLY IN M6A.

-- Per-tenant tax configuration; a tenant CANNOT issue until this is complete
-- + validated. (M6B, inert.)
tenant_tax_settings (
  tenant_id uuid pk/fk,
  vat_registration_type text,        -- e.g. עוסק מורשה / עוסק פטור / חברה
  vat_id text,                       -- ח.פ / עוסק number (validated)
  legal_name text, legal_address jsonb,
  default_vat_rate numeric(5,4),
  rounding_rule text,                -- documented rounding policy
  allocation_required_threshold numeric(12,2),  -- per tax year, VERIFIED
  provider_mode text,                -- disabled | sandbox | production
  is_ready_for_issue boolean default false,      -- gate; set only after checks
  updated_at timestamptz
)

-- Immutable numbering counters (§F). One row per (tenant, legal entity,
-- document type, year-scope). Drawn atomically inside the issuing RPC.
legal_invoice_sequences (
  tenant_id uuid fk, legal_entity_id uuid, document_type text,
  year_scope int,                    -- null if not per-year
  prefix text, next_value bigint,    -- monotonic, never reused
  unique (tenant_id, legal_entity_id, document_type, year_scope)
)

-- The legal document itself. IMMUTABLE after status=issued.
legal_documents (
  id uuid pk, tenant_id uuid fk, order_id uuid fk,
  document_type text,                -- tax_invoice | credit_note | ...
  status text,                       -- state machine §E
  legal_number text,                 -- assigned ONLY at issue; unique per tenant/entity/type/year
  allocation_number text,            -- from provider, when required
  issued_at timestamptz,
  legal_entity_id uuid,
  supplier_snapshot jsonb,           -- legal name/vat id at issue (frozen)
  customer_snapshot jsonb,           -- buyer legal + tax details at issue
  currency text, subtotal numeric, vat_total numeric, total numeric,
  vat_breakdown jsonb,               -- per-rate lines
  corrects_document_id uuid,         -- for credit/cancellation → target
  content_hash text,                 -- hash of the frozen legal content
  pdf_storage_path text, pdf_sha256 text,
  created_at timestamptz
  -- constraints: legal_number/allocation_number null until issued;
  -- no UPDATE of financial/identity fields once status=issued (enforced by
  -- the RPC + trigger + no direct grants).
)

legal_document_items (            -- frozen line snapshots at issue (immutable)
  id uuid pk, tenant_id uuid fk, legal_document_id uuid fk,
  name_snapshot jsonb, sku_snapshot text, quantity numeric,
  unit_price numeric, vat_rate numeric, line_subtotal numeric,
  line_vat numeric, line_total numeric
)

tax_authority_requests (          -- every outbound provider/authority call
  id uuid pk, tenant_id uuid fk, legal_document_id uuid fk,
  kind text,                         -- allocation_number | issue | cancel | verify
  idempotency_key text unique,       -- prevents double-issue
  request_payload jsonb,             -- REDACTED (no secrets/tokens)
  provider_mode text, created_at timestamptz
)

tax_authority_responses (         -- provider/authority replies (append-only)
  id uuid pk, tenant_id uuid fk, request_id uuid fk,
  http_status int, response_payload jsonb,   -- REDACTED
  allocation_number text, provider_ref text,
  outcome text,                      -- approved | rejected | pending | error
  received_at timestamptz
)

legal_document_events (           -- append-only audit trail of the lifecycle
  id uuid pk, tenant_id uuid fk, legal_document_id uuid fk,
  event text,                        -- state transitions, retries, failures
  actor_user_id uuid, actor_role text, note text, created_at timestamptz
)

archival_records (                -- 7-year archive pointers (immutable)
  id uuid pk, tenant_id uuid fk, legal_document_id uuid fk,
  archive_uri text, archived_at timestamptz,
  retention_until date, checksum text
)

signing_records (                 -- digital signature / seal metadata
  id uuid pk, tenant_id uuid fk, legal_document_id uuid fk,
  algorithm text, signature text/bytea, cert_ref text,
  signed_hash text, signed_at timestamptz
)
```

Per-table expectations:

| Table | Tenant scoping | RLS | Immutability | Retention / archive | Never editable after issue |
|---|---|---|---|---|---|
| `tenant_tax_settings` | `tenant_id` | owner/admin (+ accountant) read/write via RPC; sales_rep none | mutable config, but `is_ready_for_issue` transitions audited | keep history of changes | vat_id / legal identity used on issued docs |
| `legal_invoice_sequences` | `tenant_id` | no client access; RPC-only, `for update` lock | counters only ever **increment**; numbers **never reused** | keep forever | — (append via issue only) |
| `legal_documents` | `tenant_id` | owner/admin/accountant read; sales_rep scoped like orders (`can_access_order`); RPC-only writes | **immutable once `issued`** (financials, identity, number, allocation) | archive 7y (verify) | number, allocation, amounts, snapshots, items |
| `legal_document_items` | `tenant_id` | via parent | frozen at issue | with parent | everything |
| `tax_authority_requests/responses` | `tenant_id` | no client read of raw payloads; owner/admin see redacted summaries | append-only | keep for audit | everything |
| `legal_document_events` | `tenant_id` | owner/admin/accountant read (redacted); append-only | append-only | keep | everything |
| `archival_records` | `tenant_id` | owner/admin read; RPC-only | append-only | retention_until enforced | everything |
| `signing_records` | `tenant_id` | owner/admin read; RPC-only; **no signature material to client** | append-only | with document | everything |

---

## E. Proposed legal-invoice state machine

```
                 ┌────────────────┐
                 │ draft_internal │  (an order → candidate; still just a draft)
                 └───────┬────────┘
                         │ tenant is_ready_for_issue + validation passes
                         ▼
                 ┌────────────────┐
                 │ ready_for_issue│
                 └───────┬────────┘
                         │ user confirms issue (owner/admin/accountant)
                         ▼
                 ┌────────────────┐   snapshot frozen; content_hash computed;
                 │ issuing_locked │   record becomes NON-EDITABLE from here
                 └───────┬────────┘
                         │ provider call started (idempotency key)
                         ▼
                 ┌────────────────┐
                 │ provider_pending│──────────────┐ timeout / error
                 └───────┬────────┘               ▼
             approved    │                 ┌──────────────┐
                         ▼                 │ issue_failed │──┐ retry (same
                 ┌────────────────┐        └──────┬───────┘  │ idempotency key)
                 │ provider_approved│              └──────────┘
                 └───────┬────────┘                 │ give up
                         │ legal_number assigned;    ▼ (manual review)
                         │ allocation_number stored
                         ▼
                 ┌────────────────┐
                 │     issued     │  ← IMMUTABLE. no edits, ever.
                 └───────┬────────┘
                         │ correction needed → NEW credit_note / cancellation
                         ▼
          ┌───────────────┬─────────────────┐
          ▼               ▼                 ▼
  ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
  │cancel_request│ │  (credit doc)│  │   archived   │ (7y archive written)
  └──────┬───────┘ └──────────────┘  └──────────────┘
         ▼
  ┌──────────────┐
  │  cancelled   │  (via provider cancel/credit — NOT by deleting the row)
  └──────────────┘
```

**Allowed transitions** (only these):
`draft_internal→ready_for_issue→issuing_locked→provider_pending→
{provider_approved→issued | issue_failed}`; `issue_failed→provider_pending`
(bounded retries, same idempotency key) or `issue_failed→` manual review;
`issued→cancel_requested→cancelled` and `issued→(new credit_note)`;
`issued→archived` (archival is additive, not a status regression).

**Forbidden (must be impossible):**
- Any edit of an `issued` document's financials/identity/number/allocation.
- `issued→draft_*` or any backward move into an editable state.
- Deleting an `issued`/`cancelled` row (void via credit/cancellation only).
- Assigning a `legal_number` before `provider_approved` (where clearance is
  required) — no "optimistic" numbers.
- Re-using a `legal_number` after `issue_failed`.

**Immutability checkpoints:** at `issuing_locked` the snapshot + `content_hash`
are frozen; at `issued` the row + items + number + allocation are permanently
immutable (enforced by RPC-only writes, a guard trigger, and no direct grants).

**Failure/retry:** provider calls are **idempotent** (idempotency key per
`legal_document`). A timeout leaves the doc `provider_pending`; a reconcile
job (or a `healthCheck`/verify call) resolves it to `approved`/`failed` — it
must **never** double-issue or silently drop.

---

## F. Numbering / immutability strategy (design only)

- **Scope:** per **tenant + legal entity + document type**, optionally **per
  year** (`legal_invoice_sequences`). A tenant may map to one legal entity in
  M6; multi-entity is a later extension.
- **Monotonic, gapless where required, never reused.** Draw the next value
  **inside the issuing RPC** with `UPDATE … SET next_value = next_value + 1
  … RETURNING` under a row lock (same atomic pattern as `next_order_number`),
  so concurrent issues cannot collide or duplicate.
- **Assign the number only at `provider_approved`** (for clearance-required
  invoices) so a failed clearance never "burns" a legal number; where a
  scheme reserves-then-confirms, model the reservation explicitly and
  reconcile. Verify the correct order (number-then-clear vs clear-then-number)
  against official rules.
- **Gap handling:** if regulation forbids gaps, a failed issue must be
  recorded (`legal_document_events`) and either reconciled or the number
  formally voided per the rules — never silently skipped.
- **Audit:** every draw and every failed attempt is logged; the sequence table
  is RPC-only and never client-writable.

> **M6A implements none of this.** No sequence table, no counter, no live
> numbers. Design only.

---

## D. Feature flags (all default OFF / fail-closed)

| Env var | Default | Meaning |
|---|---|---|
| `MADAF_LEGAL_INVOICING_ENABLED` | `false` | Master switch. `false` ⇒ no legal issuing path exists at runtime. |
| `MADAF_TAX_PROVIDER_MODE` | `disabled` | `disabled` \| `sandbox` \| `production`. Not `production` ⇒ never calls the real authority. |
| `MADAF_LEGAL_NUMBERING_ENABLED` | `false` | `false` ⇒ no legal number is ever assigned. |

Rules:
- **All three default to OFF/disabled**; a missing/blank value = OFF.
- **Fail closed:** any legal path checks all applicable flags AND
  `tenant_tax_settings.is_ready_for_issue`; if any is off/incomplete →
  refuse (never issue, never partially issue).
- **Mock/demo never issues legal documents** — the flags are only ever read
  in supabase mode; mock mode has no legal path at all.
- **Production activation is a deliberate, per-tenant act**: platform flag ON
  **and** provider mode `production` **and** numbering ON **and** the tenant
  completed + validated tax settings. Any one missing ⇒ fail closed.
- Server-only; **never `NEXT_PUBLIC`**. The browser never learns provider
  config or secrets.

---

## G. Tax-authority / provider adapter (conceptual — pseudocode only)

A thin **adapter interface** isolates Madaf from any specific provider /
authority API. Real implementations (sandbox first) arrive in M6D. **No real
API calls, SDKs, or dependencies are added in M6A.**

```ts
// ⚠️ CONCEPTUAL — NOT IMPLEMENTED. Server-only. No provider dependency added.
interface LegalInvoiceProvider {
  healthCheck(): Promise<{ ok: boolean; mode: "sandbox" | "production" }>;

  // Obtain a מספר הקצאה (allocation number) where required.
  requestAllocationNumber(input: {
    idempotencyKey: string;
    legalDocumentId: string;
    payload: AllocationRequest;   // built server-side from frozen snapshot
  }): Promise<AllocationResult>;  // approved | rejected | pending | error

  verifyAllocationNumber(input: { number: string }): Promise<VerifyResult>;

  submitOrIssueInvoice(input: {
    idempotencyKey: string;
    legalDocumentId: string;
    payload: InvoicePayload;
  }): Promise<IssueResult>;

  cancelOrCreditInvoice(input: {
    idempotencyKey: string;
    targetLegalDocumentId: string;
    payload: CancelOrCreditPayload;
  }): Promise<CancelResult>;
}
```

Requirements the adapter contract must guarantee:
- **Server-only credentials** from non-public env (`SUPABASE_SERVICE_ROLE_KEY`
  is unrelated; provider creds are their own server-only vars). **Never in a
  client bundle.**
- **Idempotency keys** on every mutating call → no double-issue on retry.
- **Request/response logging with redaction:** persist to
  `tax_authority_requests/responses` with secrets/tokens/PII **redacted**;
  never log raw credentials.
- **Retry with backoff**, **explicit timeouts**, and mapped **failure
  states** (`issue_failed`, `provider_pending`) — never an unhandled throw
  that leaves the document in an ambiguous state.
- **Sandbox vs production strictly separated** by `MADAF_TAX_PROVIDER_MODE`;
  a `disabled`/`sandbox` mode can **never** reach the real authority.
- A `NullProvider` (disabled) and a `SandboxProvider` (mock) implement the
  interface first (M6D); the real provider is last (M6E, flag-gated).

---

## H. Legal PDF / output strategy (design only)

The future legal PDF is a **new renderer output**, distinct from the M5 draft
sheet, adding what a legal tax invoice requires (verify exact list):

- The **legal invoice number** and, where required, the **allocation number
  (מספר הקצאה)**.
- Full **legal entity** details (legal name, ח.פ/עוסק, VAT registration
  type, address) frozen from the tenant's tax settings **at issue**.
- **Customer tax details** (buyer legal name + tax id where applicable).
- **VAT breakdown** per rate; rounding per the documented policy.
- A **digital signature / content hash** if required, plus a **QR / barcode**
  if later mandated (verify).
- An **immutable generated copy** + an **archive copy** (7-year retention),
  with `pdf_sha256` recorded for tamper-evidence.

Until real legal issuing exists and is enabled per-tenant, **all PDFs remain
the M5 drafts** (watermark + not-a-tax-invoice notices intact). The legal
renderer is only ever invoked from the flag-gated issuing flow.

---

## I. Security / RLS plan

- **Roles:** `owner`/`admin` manage tax settings and may issue (flag-gated). A
  proposed **`accountant`** role (read + issue + credit, no catalog/team
  powers) is worth adding in M6B if a tenant separates finance from admin;
  otherwise reuse admin. **`sales_rep`** may (at most) **read** legal docs for
  their **assigned-customer** orders (like `can_access_order` today) and may
  **never** issue/cancel. A **platform_admin** (cross-tenant) role is **not**
  introduced by this plan; if ever added it must be audited and out of the
  normal RLS path.
- **Immutable issued docs:** enforced by RPC-only writes + a guard trigger
  blocking UPDATE/DELETE of issued financial/identity fields + no direct
  table grants (same lockdown posture as `documents`/`orders`).
- **Tenant isolation:** every table `tenant_id`-scoped; composite FKs; RLS
  deny-by-default; `authorize_tenant` + role checks in every RPC. No
  client-submitted tenant_id/number/amount is ever trusted.
- **Provider secret storage:** server-only env (or a server-only secret
  store), never `NEXT_PUBLIC`, never in the browser, never in the repo.
- **Service-role boundary:** legal issuing runs through **validated RPCs on
  the authenticated client** for authorization; any trusted server step
  (like signing/upload) reuses the M5C **dedicated, fail-closed** trusted
  client pattern (`src/lib/data/trusted-document-storage.ts`) — local-only by
  default, production opt-in, never exposed to the browser.
- **Storage + signed URLs for legal PDFs:** a **private** bucket (like
  `documents`), **no authenticated write policies** (trusted-server upload
  only), path validated exactly, short-lived **signed URLs** created only
  after an access check, **no public URL**. Archive copies are write-once.
- **Audit:** `legal_document_events` + `tax_authority_requests/responses`
  give a complete, append-only, redacted trail of who issued/cancelled what
  and every authority interaction.

---

## J. Phased migration plan (safe & incremental)

| Phase | Scope | Safety posture |
|---|---|---|
| **M6A** (this) | Architecture spike — docs only | No code. All flags conceptual. |
| **M6B** | `tenant_tax_settings` + feature flags + **inert** legal schema (tables + enum, **no issuing path**) | Everything off; tables unreachable by any issuing flow; RLS + grants locked; drafts unchanged. |
| **M6C** | Legal **numbering skeleton** (`legal_invoice_sequences` + RPC), **disabled by default** | Numbering only runs behind `MADAF_LEGAL_NUMBERING_ENABLED`; no live numbers in prod. |
| **M6D** | Provider **adapter** with `NullProvider` + `SandboxProvider` (mock) only | `MADAF_TAX_PROVIDER_MODE` never `production`; no real API, no dependency until vetted. |
| **M6E** | Legal invoice **issuing** behind `MADAF_LEGAL_INVOICING_ENABLED`, per-tenant `is_ready_for_issue` | Real provider integration flag-gated; drafts still default; extensive probes. |
| **M6F** | Archival + **signing** + export hardening (7-year, tamper-evident, `pdf_sha256`) | Immutable archive; retention enforced. |
| **M6G** | **External accountant/legal review** + production activation checklist; only then may draft wording drop (feature-flagged, default OFF) | Human sign-off gate before any tenant issues in production. |

Rename/re-split as needed, but keep each phase **inert-by-default and
independently revertable**.

---

## Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Accidental production issuing / draft→legal promotion | **Critical** | 3 flags default OFF + per-tenant `is_ready_for_issue`; fail-closed; no legal enum/path until M6E; drafts never renamed. |
| R2 | Wrong/changed legal requirements (threshold, fields, timing) | **Critical** | Verify against official sources per tax year; accountant/legal review (M6G); nothing hard-coded. |
| R3 | Double-issue / duplicate legal number on retry | High | Idempotency keys; atomic locked counter; assign number only at approval; reconcile job. |
| R4 | Mutating an issued invoice | High | Immutable-after-issue (RPC + trigger + no grants); corrections via credit/cancellation only. |
| R5 | Provider secret leak | High | Server-only env, never NEXT_PUBLIC/browser/repo; redacted logging. |
| R6 | Cross-tenant leakage of legal/tax data | High | tenant_id scoping + deny-by-default RLS + composite FKs + authorize_tenant. |
| R7 | Number "burned" by a failed clearance (gap) | Medium | Number at approval; log failures; void/reconcile per rules. |
| R8 | Losing the 7-year archive / tamper | Medium | Write-once archive + `pdf_sha256` + retention_until; signing records. |
| R9 | Provider outage blocks issuing | Medium | `provider_pending` state + retry/backoff + healthCheck; never silent loss. |
| R10 | PII in logs / responses | Medium | Redaction on `tax_authority_requests/responses`; access-scoped, no raw payloads to clients. |

---

## Implementation checklist (for M6B / M6C)

**M6B — tax settings + flags + inert schema**
- [ ] Add the three feature-flag envs to `.env.example` (all OFF) + a
      server-only flag reader (fail-closed; never `NEXT_PUBLIC`).
- [ ] Migration: `tenant_tax_settings` (+ RLS deny-by-default, RPC-only
      writes, no direct grants); `is_ready_for_issue` defaults false.
- [ ] Migration: **inert** `legal_documents` / `legal_document_items` /
      sequences / requests / responses / events / archival / signing tables
      with RLS + grants locked and **no issuing RPC** yet.
- [ ] `set_tenant_tax_settings` RPC (owner/admin, validates vat_id/type);
      does **not** enable issuing.
- [ ] Admin UI: a **tax settings** form (clearly "required before any future
      legal issuing; nothing is issued yet").
- [ ] Probes: no legal path reachable; drafts unchanged; grant/direct-write
      audit; flags OFF ⇒ nothing issues; mock unaffected.

**M6C — numbering skeleton (disabled)**
- [ ] Migration: `legal_invoice_sequences` + `_draw_legal_number` RPC
      (atomic locked counter), **gated by `MADAF_LEGAL_NUMBERING_ENABLED`**.
- [ ] Unit/DB probes: concurrency (no duplicates), no reuse, gapless where
      required, disabled-by-default returns nothing.
- [ ] No route calls it; no live numbers in any default config.

---

## Known open questions (for the M6B author + reviewers)

1. **Current threshold + timeline** for the allocation-number requirement
   (per tax year) — official value?
2. **Clearance ordering:** assign legal number *before* or *after* the
   allocation number is granted? Reserve-then-confirm?
3. **Direct SHAAM integration vs a certified provider** — which, and what are
   the registration/certification steps and costs?
4. **Signing/QR:** is a digital signature and/or QR code mandatory, and in
   what format?
5. **Multi-legal-entity** per tenant — needed in M6, or a later extension?
6. **Accountant role** — add a distinct role, or keep issuing under admin?
7. **Retention specifics:** exact archival duration, format, and any
   export/immutability obligations.
8. **Credit vs cancellation** — which correction document(s) does the law
   require, and their numbering?

> Answer these against **official sources** and a **professional review**
> before writing M6B code. Until then, Madaf issues **drafts only**.
