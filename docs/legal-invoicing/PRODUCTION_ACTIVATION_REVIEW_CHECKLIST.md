# Madaf — Legal Invoicing: Production Activation Review Gate (M6G)

> # ⛔ NO PRODUCTION / LEGAL INVOICING ACTIVATION IS PERMITTED
> until a **qualified Israeli accountant / tax advisor AND legal counsel** have
> reviewed and approved the requirements below against **current official Israel
> Tax Authority (רשות המסים) / "חשבוניות ישראל" sources**, and every gate in this
> document is signed off.
>
> **M6G is DOCUMENTATION ONLY.** It changes no code, no schema, no runtime
> behavior, and enables nothing. It is the human sign-off gate that stands
> between the sandbox track (M6B–M6F) and any future real issuing (M6H+).

This is **not** legal, tax, or accounting advice. Nothing here asserts what
current Israeli law requires — the tables below are **placeholders for qualified
reviewers to fill in with cited official sources**. Do not treat any threshold,
timeline, field list, or rule as current fact until a reviewer has cited and
approved it.

---

## 1. Hard status (what is TRUE in `main` today, M6F)

Everything shipped in the M6 legal-invoicing track is **SANDBOX-ONLY / NON-LEGAL
/ default-disabled**. Concretely, in the current codebase:

- **`legal_effective` is HARD-FALSE.** DB CHECK constraints make a
  legally-effective row impossible on `legal_documents`, `tax_authority_responses`,
  `archival_records`, and `signing_records`
  (`*_never_legal_effective` / `*_m6e_never_legal_effective` /
  `*_m6f_never_legal_effective`).
- **Provider "production" mode is UNSUPPORTED.** `taxProviderMode()`
  (`src/lib/config/legal-invoicing.ts`) clamps anything that is not `sandbox` to
  `disabled`; only a `NullProvider` (disabled) or a deterministic `SandboxProvider`
  (mock) exist (`src/lib/legal-invoicing/provider/`). No real provider.
- **No real allocation-number flow exists.** The sandbox provider returns obvious
  placeholders (`SANDBOX-DO-NOT-USE-…`); `verifyAllocationNumber` only accepts
  SANDBOX-shaped values.
- **No real tax authority / SHAAM call exists.** There is no `fetch`/HTTP/network
  call anywhere under `src/lib/legal-invoicing/`.
- **No real provider credentials exist.** No provider API-key / secret env var is
  read; none is defined in `.env.example`.
- **No legal PDF exists.** The only PDFs are the M5 **DRAFT** documents (watermark
  + "not a tax invoice" notice, unchanged). The legal layer creates no PDF.
- **No real signing / certificate / archive exists.** `signing_records` stores
  only `SANDBOX-…` placeholder signatures / `SANDBOX-NO-CERT`; `archival_records`
  stores a `sandbox://non-legal/…` placeholder URI; both are write-once
  tamper-evidence mocks over a canonical JSON hash — not a real archive/signature.
- **No payments exist.** No payment provider, package, or UI anywhere.
- **Default-disabled + fail-closed.** The whole flow is gated by three server-only
  env flags (all default OFF, never `NEXT_PUBLIC`) **and** a service-role-only DB
  kill switch (`legal_numbering_settings.enabled`, default `false`), **and**
  owner/admin authorization, **and** per-tenant readiness. The orchestration /
  archival helpers are **dormant** — no route, action, or UI imports them.
- **The M5 `invoice_draft` and every draft watermark / "not a tax invoice" notice
  are unchanged** in all three languages.

See the current-implementation inventory in the Appendix.

---

## 2. Non-negotiable activation rule

Production / legal issuing (i.e. anything that would make `legal_effective` able
to be `true`, or send a real request to a tax authority / certified provider)
**MUST NOT** be enabled until **ALL** of the following are complete and signed:

- [ ] Qualified **Israeli accountant / tax advisor** review complete + signed.
- [ ] **Legal counsel** review complete + signed.
- [ ] **Current official** Israel Tax Authority / "חשבוניות ישראל" sources
      verified and cited (Section 3).
- [ ] **Certified provider / integration contract** reviewed (or direct SHAAM
      integration certification reviewed).
- [ ] **Data retention / archive / signing** requirements verified.
- [ ] **Security / privacy** review complete.
- [ ] **Test plan** and **rollback / deactivation plan** approved.

| Approval | Name / firm | Role | Date | Signature ref |
|---|---|---|---|---|
| Accountant / tax advisor | | | | |
| Legal counsel | | | | |
| Security reviewer | | | | |
| Product / tenant owner | | | | |

Until every row above is signed, the answer to "can we turn it on?" is **no**.

---

## 3. Official-source verification checklist (reviewers fill in)

> **Do NOT invent current law.** For each topic, a reviewer must record the
> official source and their conclusion. Leave a row **blocked** until cited.

For every topic below, complete one record:

- **Source URL:**
- **Source title:**
- **Publication / last-update date:**
- **Reviewed by:**
- **Review date:**
- **Conclusion (verbatim requirement, in scope terms):**
- **Implementation impact (what the code/schema must do):**
- **Open risk / ambiguity:**

Topics to verify (each needs its own record above):

1. [ ] חשבוניות ישראל / allocation-number (מספר הקצאה) **threshold** (per tax year).
2. [ ] **When** an allocation number is required (document types, amounts, buyer type).
3. [ ] Exact **clearance flow ordering** (number-then-clear vs clear-then-number; reserve/confirm).
4. [ ] **Mandatory invoice fields** (issuer legal name + ח.פ/עוסק, VAT type, buyer details, breakdown, dates, etc.).
5. [ ] **VAT / tax rates** and **rounding rules**.
6. [ ] **Credit invoice / cancellation** rules and required document(s).
7. [ ] **Numbering / gap / reuse** rules (gapless where required; void/reconcile).
8. [ ] **Digital signing** requirements (algorithm, certificate, who signs).
9. [ ] **QR / hash** requirements, if any (format, contents).
10. [ ] **Archive retention** period + format + immutability obligations.
11. [ ] **Customer copy** requirements (delivery, format, language).
12. [ ] **Accountant access** expectations (read/export, roles).
13. [ ] **Multi-entity / branch / legal-entity** modeling requirements.
14. [ ] **Provider certification** requirements (software-house registration, cert).
15. [ ] **Sandbox vs production** certification and separation requirements.
16. [ ] **Privacy / PII** handling (what may be stored, logged, transmitted).
17. [ ] **Audit trail** requirements (what must be recorded, retention).
18. [ ] **Failure / retry / reconciliation** rules (idempotency, no double-issue).
19. [ ] **Offline / partial-failure** behavior (allowed states, resolution).
20. [ ] **Language requirements** (Hebrew / Arabic / English) for the issued document.

---

## 4. Technical activation checklist (future PRs must address)

None of the following may be built until Section 2 is signed and the relevant
Section 3 topic is cited. Each item is a **future PR's** responsibility:

- [ ] **Relaxing the `legal_effective = false` CHECK safely** — a dedicated,
      reviewed migration; never a silent/loosened constraint. Define exactly when
      a row may become legal-effective.
- [ ] **Production provider mode design** — how `sandbox` → `production` is
      selected, isolated, and cannot be reached by accident.
- [ ] **Certified provider credentials storage** — server-only secret store,
      never `NEXT_PUBLIC`, never in the repo/client bundle.
- [ ] **Secret rotation** procedure.
- [ ] **Real allocation-number request / verify** (against the certified API).
- [ ] **Legal document state machine** (draft → issuing_locked → provider_pending
      → provider_approved → issued; failure/retry states) with snapshot freeze.
- [ ] **`legal_number` assignment rules** (scope, monotonicity, when assigned).
- [ ] **`allocation_number` persistence rules** (when stored; never before approval).
- [ ] **Immutable snapshot / `content_hash`** at issue (frozen identity/financials).
- [ ] **Legal PDF generation** (a NEW renderer, distinct from the M5 draft sheet).
- [ ] **Signing / archive implementation** (real algorithm, certificate, storage).
- [ ] **Retention implementation** (period, format, write-once, verified).
- [ ] **Refund / credit / cancellation flow** (correction documents, numbering).
- [ ] **Provider retry / reconcile flow** (idempotent, no double-issue, timeouts).
- [ ] **Accountant / admin roles** (a distinct accountant role if required).
- [ ] **Per-tenant readiness review** (what makes a tenant genuinely ready).
- [ ] **Per-tenant legal-entity model** (if multi-entity is required).
- [ ] **Monitoring / alerts** (issuing failures, drift, stuck states).
- [ ] **Incident response** (a mis-issued/duplicate legal invoice runbook).
- [ ] **Rollback / deactivation** (turn issuing off safely, mid-flight states).

---

## 5. Required PR gates

Any future PR that attempts to enable **real** issuing (or move toward it) MUST
include, in the PR description, ALL of:

- [ ] **Official-source citations** (the filled-in Section 3 records it relies on).
- [ ] **Professional review sign-off** (Section 2 table, relevant rows signed).
- [ ] **Security review.**
- [ ] **DB migration review** (append-only; constraint changes justified).
- [ ] **RLS review** (no grant widening; no direct client writes to legal tables).
- [ ] **Provider contract review** (certified integration terms).
- [ ] **End-to-end test plan** (sandbox → production parity, negative cases).
- [ ] **Rollback plan.**
- [ ] **Production secrets plan** (storage, rotation, least privilege).
- [ ] **Logs / redaction plan** (no raw secrets/tokens/PII in logs).
- [ ] **Data retention plan.**
- [ ] **Explicit Codex / security review approval.**
- [ ] **Human owner approval.**

A PR missing any of these must not enable real issuing, even partially.

---

## 6. Red-line list — NEVER allowed

These are hard "no" regardless of pressure or convenience:

- ❌ `NEXT_PUBLIC` service-role key (or any service-role key in a client bundle).
- ❌ Provider credentials in the client bundle.
- ❌ Direct authenticated writes to the legal tables (`legal_documents`,
  `legal_invoice_sequences`, `tax_authority_requests`/`responses`, `archival_records`,
  `signing_records`, `legal_numbering_settings`) — writes stay RPC/service-role only.
- ❌ Legal issuing from tokenized-customer routes.
- ❌ Issuing without tenant readiness.
- ❌ Issuing without the required official provider response (where required).
- ❌ `legal_effective = true` without the Section 2 review.
- ❌ Production provider mode without the Section 2 review.
- ❌ A legal PDF without verified requirements.
- ❌ Silent retry that may **duplicate** a legal invoice.
- ❌ Legal-number reuse without an approved gap/reuse policy.
- ❌ Storing raw secrets / tokens / private-link hashes in logs or payloads.

---

## Appendix — current M6 implementation inventory (reviewer reference)

Accurate as of M6F (`main`). All of this is sandbox-only / non-legal.

**Server-only flags** (`src/lib/config/legal-invoicing.ts`; default OFF; never `NEXT_PUBLIC`):
- `MADAF_LEGAL_INVOICING_ENABLED` (master switch)
- `MADAF_TAX_PROVIDER_MODE` (`disabled` | `sandbox`; `production` clamped to `disabled`)
- `MADAF_LEGAL_NUMBERING_ENABLED`

**DB kill switch:** `legal_numbering_settings.enabled` (single row, default `false`,
service-role-only; a normal client cannot read or flip it).

**Tables (M6B) + sandbox markers (M6E/M6F):** `tenant_tax_settings`,
`legal_documents`, `legal_document_items`, `legal_invoice_sequences`,
`legal_document_events`, `tax_authority_requests`, `tax_authority_responses`,
`archival_records`, `signing_records`. HARD CHECK `legal_effective = false` on
`legal_documents` / `tax_authority_responses` / `archival_records` /
`signing_records`; `provider_mode` limited to `sandbox`/null; signing
algorithm/signature/cert constrained to `SANDBOX%` placeholders; archival + signing
are write-once (unique per document + immutability triggers).

**RPCs (SECURITY DEFINER, `search_path=''`, owner/admin via `authorize_tenant`):**
- `get_tenant_tax_settings` / `upsert_tenant_tax_settings` (M6B, owner/admin).
- `draw_legal_document_number` (M6C/M6C.1; internal `DRAFT-LEGAL-YYYY-######` preview;
  fail-closed behind the DB kill switch; year `2000..2100`; entity rejected).
- `sandbox_issue_legal_document` (M6E/M6E.1; requires tenant readiness `MDF73`, draws
  the number in-RPC, no caller JSON, idempotency-before-draw).
- `sandbox_archive_and_sign_legal_document` (M6F; validates the target is an M6E
  sandbox non-legal doc `MDF75`, write-once `MDF74`, canonical JSON + SHA-256 in SQL).

**App modules (server-only, DORMANT — imported by no route/action/UI):**
`src/lib/legal-invoicing/provider/` (Null/Sandbox), `…/orchestration/`,
`…/archival/`; plus dormant data helpers `src/lib/data/legal-numbering.ts`.

**Error codes:** `MDF60` (numbering disabled), `MDF61` (invalid year), `MDF62`
(entity not implemented), `MDF70` (sandbox orchestration disabled), `MDF71`
(duplicate idempotency), `MDF72` (non-sandbox provider mode), `MDF73` (tenant tax
not ready), `MDF74` (already archived/signed), `MDF75` (target not a sandbox
non-legal document).

**Guardrails proven by tests/probes across M6B–M6F:** anon/sales_rep/non-member/
cross-tenant blocked; direct authenticated writes denied; `signing_records` not
client-readable; deterministic hashes; obvious sandbox placeholders; no legal_effective
rows anywhere; drafts + "not a tax invoice" notices intact.

---

_Phase order:_ M6A design → M6B inert schema/settings → M6C numbering skeleton →
M6D sandbox provider → M6E sandbox orchestration → M6F sandbox archival/signing →
**M6G (this) external review gate** → M6H+ real issuing, **only after** the above
is signed.
