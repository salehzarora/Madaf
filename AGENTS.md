<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Madaf — Agent operating rules

Madaf is a trilingual B2B supplier catalog, ordering and inventory platform for
the local Israeli market. Arabic, Hebrew and English are supported; RTL is
first-class.

## Roles and authority

- The Owner makes final product and release decisions.
- ChatGPT Control Room defines approved scope, architecture decisions and
  acceptance criteria. Codex plans and implements approved work, then reports
  for Control Room review.
- Do not use Claude or another implementation agent unless the Owner explicitly
  authorizes it. Passing tests never authorizes a merge, deployment or launch.

Resolve current-state claims in this order:

1. Actual code and latest effective migrations for implemented behavior.
2. [Monitored Pilot launch runbook](docs/pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md).
3. [Backup, restore and recovery](docs/pilot/BACKUP_RESTORE_AND_RECOVERY.md).
4. Current scoped product documentation under `docs/product/`.
5. Auth, security and legal specialist documentation.
6. Historical milestone and handoff sections.

Historical “current phase”, “not deployed” and “recommended next” statements
record their milestone; they never override current code or the Pilot runbook.
Code being implemented does not establish hosted verification or release approval.

## Operational boundary

**PRE-PILOT REHEARSAL — AUTHORIZED**

**REAL CUSTOMER GO — BLOCKED PENDING SUPABASE UPGRADE AND HOSTED GO VERIFICATION**

Rehearsal uses synthetic data only. No real customer PII or commercial orders
until GO is separately approved. Do not claim backup/PITR readiness or hosted
migration parity without separate verification, or change the runbook's decision.

## Read before changing

Always read this file and the relevant current product document. Read the Pilot
runbook whenever operational or release behavior is involved. Follow this scoped
map instead of reading every historical handoff:

| Change area | Required reading |
| --- | --- |
| Auth, tenants, roles, public tokens | [Auth and access model](docs/AUTH_AND_ACCESS_MODEL.md) |
| Database, RLS, RPCs, migrations | [Supabase setup](supabase/README.md), relevant latest migrations and tests |
| UI and design | [Design system](docs/DESIGN_SYSTEM.md), [i18n and RTL guide](docs/I18N_RTL_GUIDE.md) |
| Documents and legal invoicing | [Documents guide](docs/DOCUMENTS_AND_INVOICES_GUIDE.md), [legal architecture](docs/LEGAL_INVOICING_ARCHITECTURE.md), [production activation checklist](docs/legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md) when applicable |
| Pilot, production, hosted infrastructure | [Pilot runbook](docs/pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md), [recovery plan](docs/pilot/BACKUP_RESTORE_AND_RECOVERY.md) |
| Next.js behavior | Relevant version-matched guides in `node_modules/next/dist/docs/` |

## Hard invariants

- **Tenant security:** client-provided tenant IDs, roles, prices and totals are
  never authoritative. Membership and authorization come from the server/database.
  Preserve deny-by-default RLS; do not casually widen anon/authenticated grants.
  Protected mutations remain RPC/server-action controlled; never restore direct
  protected-table writes. Preserve last-owner protection and prevent self-promotion.
- **Sales reps:** `sales_rep` customer and order access remains assignment scoped
  with current membership checks. Never fall back to all customers.
- **Tokens:** never persist or log full raw private-link, invite or order tokens.
  Preserve existing hash/fingerprint boundaries and restricted preview suffixes;
  never add raw tokens to browser persistence or logs.
- **Orders:** preserve submission-key/idempotency guarantees for the authenticated
  cart, private shop links and showcase flow, including retries after refresh or
  ambiguous responses. Never add a second, non-idempotent order creation path.
- **Inventory:** preserve deterministic locking, reservation, restoration and
  reconciliation semantics. Do not weaken concurrency protection.
- **Audit:** streams remain append-only and system-controlled within existing
  boundaries. Unknown entity types deny visibility to non-owner/admin users.
  Do not leak sensitive metadata: preserve event allowlists and safe projections;
  never add secrets, raw tokens or arbitrary sensitive payloads.
- **Data access:** UI uses `src/lib/data/`, never bypassing it for direct mock or
  database access. Mock mode stays zero-config; Supabase mode stays tenant scoped.
- **Schema:** use new additive migrations; never edit historical migrations.
  After schema changes, regenerate `src/lib/supabase/database.types.ts` using the
  documented workflow. Never hand-edit generated database types.
- **i18n/RTL:** user-facing UI strings use typed AR/HE/EN dictionaries in
  `src/i18n/dictionaries/`. Preserve logical CSS and bidi-safe numbers, phones,
  SKUs and other identifiers.
- **Tenant time:** business dates/times use the tenant timezone explicitly, never
  the machine/browser timezone as authority. Preserve Temporal-backed local-day
  boundaries and inclusive-start/exclusive-next-day ranges; date-only values stay
  date-only.
- **Legal:** the legal stack remains non-legal, sandbox and default-off, with
  `legal_effective=false`. Invoice drafts keep draft warnings and watermarks.
  No tax invoice/legal issuance activation without the existing professional
  review gate and separate Control Room approval.
- **Payments:** no payment feature exists in the approved product scope. Do not
  introduce one incidentally.
- **Secrets/config:** never commit secrets or expose service-role/provider
  credentials to the browser or `NEXT_PUBLIC` variables. Hosted Supabase/Vercel
  configuration changes require explicit approval.

## Task and Git discipline

- Start approved work from current `main`, unless continuing an explicitly approved
  branch. Keep one bounded task/milestone per branch or approved continuation.
- Inspect before editing; prefer the smallest safe diff and no unrelated refactors.
  Do not silently expand scope. Report unrelated blockers separately.
- Run the task's required checks using the repository's CI-compatible Node runtime.
  Report all modified files, tests, findings and unresolved issues honestly; never
  claim a check ran when it did not.
- Never push unless the task explicitly authorizes it. Never merge or deploy
  without Control Room approval.
- Keep Madaf instructions outside the Next.js managed markers. After any Next
  command, verify this custom section remains intact and report managed-block
  changes. Never restore an old whole file in a way that discards these rules.
