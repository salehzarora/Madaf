-- ═══════════════════════════════════════════════════════════════════════
-- Madaf M6B — INERT legal-invoicing schema skeleton
--
-- ⚠️⚠️ LEGAL / SAFETY — READ docs/LEGAL_INVOICING_ARCHITECTURE.md FIRST ⚠️⚠️
-- This migration creates the FUTURE legal-invoicing tables (per the M6A
-- design) so later phases (M6C+) can be built without rearchitecting. It is
-- entirely INERT:
--   • NO issuing RPC, NO numbering RPC, NO provider call, NO tax-authority
--     call, NO allocation-number request, NO legal PDF route, NO storage
--     bucket — none of that exists here.
--   • These tables are UNREACHABLE by any application write path: no INSERT/
--     UPDATE/DELETE grants or policies for anon/authenticated at all. Only
--     the service_role (local bootstrap/seed/future server code) can write,
--     and even then an `issued` document is immutable (guard trigger below).
--   • `status` defaults to `draft_internal`; the `issued`/provider statuses
--     cannot be reached by any app path in M6B.
--   • `legal_number`, `allocation_number` and provider fields are nullable
--     and unset — no live legal numbers exist anywhere.
--   • The existing M5 `documents` family (order_request/delivery_note/
--     invoice_draft) is a SEPARATE, unchanged family. invoice_draft stays a
--     DRAFT with its "not a tax invoice" notice + DRAFT watermark. Nothing
--     here promotes or mutates a draft.
--
-- Madaf does NOT issue legal tax invoices. This schema is scaffolding only;
-- real issuing requires M6C-M6G (numbering, provider adapter, flag-gated
-- issuing, archival/signing) AND a professional tax/accounting/legal review
-- AND per-tenant readiness AND server-side feature flags that default OFF.
--
-- Posture mirrors the rest of the schema (docs/AUTH_AND_ACCESS_MODEL.md):
-- tenant_id-scoped, composite FKs, deny-by-default RLS, grant-locked
-- (no TRUNCATE/REFERENCES/TRIGGER/MAINTAIN for API roles), and SECURITY
-- DEFINER-only writes in the future (none in M6B).
-- ═══════════════════════════════════════════════════════════════════════

-- ── 1. Enums (proposed types arrive WITH the inert tables, not before) ────
create type public.legal_document_type as enum (
  'tax_invoice',
  'tax_invoice_receipt',
  'credit_note',
  'cancellation_notice'
);

create type public.legal_document_status as enum (
  'draft_internal',      -- default; an order → candidate, still just a draft
  'ready_for_issue',
  'issuing_locked',      -- snapshot frozen; non-editable from here (future)
  'provider_pending',
  'provider_approved',
  'issued',              -- IMMUTABLE once reached (future; unreachable in M6B)
  'issue_failed',
  'cancel_requested',
  'cancelled',
  'archived'
);

-- ── 2. legal_invoice_sequences — immutable counters (RPC-only, no client) ─
-- One row per (tenant, legal entity, document type, year-scope). Numbers are
-- drawn atomically INSIDE a future issuing RPC (M6C) under a row lock, never
-- reused. INERT here: no draw RPC exists, so no numbers are ever assigned.
create table public.legal_invoice_sequences (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_entity_id uuid,            -- single-entity for now (nullable)
  document_type public.legal_document_type not null,
  year_scope integer,              -- null when not per-year
  prefix text,
  next_value bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint legal_invoice_sequences_next_value_nonneg check (next_value >= 1),
  unique nulls not distinct (tenant_id, legal_entity_id, document_type, year_scope)
);

comment on table public.legal_invoice_sequences is
  'M6B (INERT): future immutable legal-number counters, one per (tenant, entity, type, year). RPC-only + service-role only; no draw RPC exists in M6B so no numbers are ever assigned. Never client-writable.';

create trigger legal_invoice_sequences_set_updated_at
  before update on public.legal_invoice_sequences
  for each row execute function public.set_updated_at();

create index legal_invoice_sequences_tenant_idx
  on public.legal_invoice_sequences (tenant_id);

-- ── 3. legal_documents — the legal document (IMMUTABLE once issued) ───────
create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Optional link to the source order (composite FK enforced only when set).
  order_id uuid,
  legal_entity_id uuid,
  document_type public.legal_document_type not null,
  status public.legal_document_status not null default 'draft_internal',
  -- Assigned ONLY at issue (future). Null/unset in M6B.
  legal_number text,
  allocation_number text,          -- מספר הקצאה, from provider when required
  issued_at timestamptz,
  -- Frozen identity/financials at issue (future). Null in M6B.
  supplier_snapshot jsonb,
  customer_snapshot jsonb,
  currency text,
  subtotal numeric(12, 2),
  vat_total numeric(12, 2),
  total numeric(12, 2),
  vat_breakdown jsonb,
  corrects_document_id uuid,        -- credit/cancellation → target document
  content_hash text,
  pdf_storage_path text,
  pdf_sha256 text,
  created_at timestamptz not null default now(),
  -- Composite-unique so children + the self-reference can cross-tenant-safe FK.
  unique (tenant_id, id),
  foreign key (tenant_id, order_id)
    references public.orders (tenant_id, id) on delete no action,
  foreign key (tenant_id, corrects_document_id)
    references public.legal_documents (tenant_id, id) on delete no action,
  constraint legal_documents_currency_len
    check (currency is null or char_length(currency) = 3),
  -- A legal number / allocation number may exist ONLY once issued-like. In
  -- M6B nothing reaches those statuses, so both always stay null.
  constraint legal_documents_number_only_when_issued check (
    legal_number is null
    or status in ('issued', 'cancel_requested', 'cancelled', 'archived')
  ),
  constraint legal_documents_allocation_only_when_issued check (
    allocation_number is null
    or status in ('provider_approved', 'issued', 'cancel_requested', 'cancelled', 'archived')
  ),
  constraint legal_documents_issued_at_only_when_issued check (
    issued_at is null
    or status in ('issued', 'cancel_requested', 'cancelled', 'archived')
  )
);

comment on table public.legal_documents is
  'M6B (INERT): future legal documents (tax_invoice/credit_note/…), a SEPARATE family from the M5 draft documents. Unreachable by any app write path in M6B; status defaults to draft_internal; legal_number/allocation_number stay null. IMMUTABLE once issued (guard trigger). Not a legal tax invoice today — see docs/LEGAL_INVOICING_ARCHITECTURE.md.';

create index legal_documents_tenant_idx on public.legal_documents (tenant_id);
create index legal_documents_tenant_order_idx
  on public.legal_documents (tenant_id, order_id);

-- Immutability guard: an issued document's financial/identity/number fields
-- can NEVER be edited, and an issued/cancelled/archived row can NEVER be
-- deleted (corrections happen via a NEW credit/cancellation document). Fires
-- for EVERY writer (incl. service_role/future definer RPCs), so a future bug
-- cannot mutate history. Inert in M6B (no issued rows exist).
create or replace function public._legal_documents_guard_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status in ('issued', 'cancelled', 'archived') then
      raise exception
        'legal_documents: an issued/cancelled/archived document cannot be deleted (void via a credit/cancellation document, never by deletion)'
        using errcode = '42501';
    end if;
    return old;
  end if;

  -- UPDATE: once issued, the frozen fields are permanently immutable. Status
  -- may still advance (e.g. issued → archived) but the content cannot change.
  if old.status = 'issued' then
    if new.tenant_id is distinct from old.tenant_id
       or new.document_type is distinct from old.document_type
       or new.legal_number is distinct from old.legal_number
       or new.allocation_number is distinct from old.allocation_number
       or new.issued_at is distinct from old.issued_at
       or new.subtotal is distinct from old.subtotal
       or new.vat_total is distinct from old.vat_total
       or new.total is distinct from old.total
       or new.currency is distinct from old.currency
       or new.supplier_snapshot is distinct from old.supplier_snapshot
       or new.customer_snapshot is distinct from old.customer_snapshot
       or new.vat_breakdown is distinct from old.vat_breakdown
       or new.content_hash is distinct from old.content_hash then
      raise exception
        'legal_documents: the financial/identity/number fields of an issued document are immutable'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

comment on function public._legal_documents_guard_immutable() is
  'Immutability guard for legal_documents: blocks DELETE of issued/cancelled/archived rows and any edit of an issued row''s frozen financial/identity/number fields. Fires for all writers. Inert in M6B (no issued rows).';

create trigger legal_documents_guard_immutable
  before update or delete on public.legal_documents
  for each row execute function public._legal_documents_guard_immutable();

-- ── 4. legal_document_items — frozen line snapshots (immutable at issue) ──
create table public.legal_document_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_document_id uuid not null,
  name_snapshot jsonb,
  sku_snapshot text,
  quantity numeric(12, 3),
  unit_price numeric(12, 2),
  vat_rate numeric(5, 4),
  line_subtotal numeric(12, 2),
  line_vat numeric(12, 2),
  line_total numeric(12, 2),
  created_at timestamptz not null default now(),
  foreign key (tenant_id, legal_document_id)
    references public.legal_documents (tenant_id, id) on delete cascade
);

comment on table public.legal_document_items is
  'M6B (INERT): future frozen line snapshots for a legal document. Written only with the parent at issue (future); no app write path in M6B.';

create index legal_document_items_doc_idx
  on public.legal_document_items (tenant_id, legal_document_id);

-- ── 5. legal_document_events — append-only lifecycle audit trail ──────────
create table public.legal_document_events (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_document_id uuid not null,
  event text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  actor_role text,
  note text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, legal_document_id)
    references public.legal_documents (tenant_id, id) on delete cascade
);

comment on table public.legal_document_events is
  'M6B (INERT): future append-only audit trail of a legal document''s lifecycle (state transitions, retries, failures). No app write path in M6B.';

create index legal_document_events_doc_idx
  on public.legal_document_events (tenant_id, legal_document_id, created_at);

-- ── 6. tax_authority_requests — outbound provider/authority calls ─────────
-- REDACTED payloads only (no secrets/tokens ever). No client read at all.
create table public.tax_authority_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_document_id uuid,
  kind text,                        -- allocation_number | issue | cancel | verify
  idempotency_key text unique,      -- prevents double-issue on retry
  request_payload jsonb,            -- REDACTED (no secrets/tokens/PII)
  provider_mode text,               -- disabled | sandbox | production
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, legal_document_id)
    references public.legal_documents (tenant_id, id) on delete no action
);

comment on table public.tax_authority_requests is
  'M6B (INERT): future record of every outbound provider/tax-authority call, with REDACTED payloads (never secrets/tokens). No client access; no request path exists in M6B.';

create index tax_authority_requests_doc_idx
  on public.tax_authority_requests (tenant_id, legal_document_id);

-- ── 7. tax_authority_responses — provider/authority replies (append-only) ─
create table public.tax_authority_responses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  request_id uuid,
  http_status integer,
  response_payload jsonb,           -- REDACTED (no secrets/tokens/PII)
  allocation_number text,
  provider_ref text,
  outcome text,                     -- approved | rejected | pending | error
  received_at timestamptz not null default now(),
  foreign key (tenant_id, request_id)
    references public.tax_authority_requests (tenant_id, id) on delete no action
);

comment on table public.tax_authority_responses is
  'M6B (INERT): future provider/tax-authority replies, REDACTED, append-only. No client access; no response path exists in M6B.';

create index tax_authority_responses_request_idx
  on public.tax_authority_responses (tenant_id, request_id);

-- ── 8. archival_records — 7-year archive pointers (write-once, future) ────
create table public.archival_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_document_id uuid not null,
  archive_uri text,
  archived_at timestamptz not null default now(),
  retention_until date,
  checksum text,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, legal_document_id)
    references public.legal_documents (tenant_id, id) on delete no action
);

comment on table public.archival_records is
  'M6B (INERT): future 7-year archive pointers for issued legal documents (write-once). No app write path in M6B; retention specifics to be verified (M6F).';

create index archival_records_doc_idx
  on public.archival_records (tenant_id, legal_document_id);

-- ── 9. signing_records — digital signature / seal metadata (future) ───────
-- No signature material is ever exposed to a client.
create table public.signing_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  legal_document_id uuid not null,
  algorithm text,
  signature text,
  cert_ref text,
  signed_hash text,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, legal_document_id)
    references public.legal_documents (tenant_id, id) on delete no action
);

comment on table public.signing_records is
  'M6B (INERT): future digital signature / seal metadata for issued legal documents. No client access (signature material never reaches the browser); no app write path in M6B.';

create index signing_records_doc_idx
  on public.signing_records (tenant_id, legal_document_id);

-- ── 10. RLS + grants — deny by default; NO write path for any client ─────
-- Enable RLS on every new table.
alter table public.legal_invoice_sequences enable row level security;
alter table public.legal_documents enable row level security;
alter table public.legal_document_items enable row level security;
alter table public.legal_document_events enable row level security;
alter table public.tax_authority_requests enable row level security;
alter table public.tax_authority_responses enable row level security;
alter table public.archival_records enable row level security;
alter table public.signing_records enable row level security;

-- Strip the default ACL from anon/authenticated on ALL new tables. NONE of
-- them grant INSERT/UPDATE/DELETE to any API role — there is no issuing path.
revoke all on
  public.legal_invoice_sequences,
  public.legal_documents,
  public.legal_document_items,
  public.legal_document_events,
  public.tax_authority_requests,
  public.tax_authority_responses,
  public.archival_records,
  public.signing_records
from anon, authenticated;
revoke truncate, references, trigger, maintain on
  public.legal_invoice_sequences,
  public.legal_documents,
  public.legal_document_items,
  public.legal_document_events,
  public.tax_authority_requests,
  public.tax_authority_responses,
  public.archival_records,
  public.signing_records
from anon, authenticated;

-- service_role: full access (bypasses RLS; used by future server code/seed).
grant select, insert, update, delete on
  public.legal_invoice_sequences,
  public.legal_documents,
  public.legal_document_items,
  public.legal_document_events,
  public.tax_authority_requests,
  public.tax_authority_responses,
  public.archival_records,
  public.signing_records
to service_role;

-- owner/admin READ-only (SELECT grant + policy) on the non-sensitive tables.
-- No sales_rep, no anon, no non-member. No write grants/policies anywhere.
grant select on
  public.legal_documents,
  public.legal_document_items,
  public.legal_document_events,
  public.archival_records
to authenticated;

create policy "legal_documents: owner/admin read their tenant"
  on public.legal_documents for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "legal_document_items: owner/admin read their tenant"
  on public.legal_document_items for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "legal_document_events: owner/admin read their tenant"
  on public.legal_document_events for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

create policy "archival_records: owner/admin read their tenant"
  on public.archival_records for select to authenticated
  using (public.has_tenant_role(tenant_id, array['owner', 'admin']::public.tenant_role[]));

-- Sensitive tables (counters, raw provider payloads, signature material) get
-- NO authenticated grants and NO policies at all — service_role only, exactly
-- like token_access_attempts. Deny-by-default with RLS enabled means every
-- anon/authenticated read/write is refused.
--   legal_invoice_sequences, tax_authority_requests,
--   tax_authority_responses, signing_records

-- Sequences (identity columns) writable only by the service role.
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon;
