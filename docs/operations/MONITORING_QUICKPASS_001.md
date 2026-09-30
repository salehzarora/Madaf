# MONITORING-QUICKPASS-001

Local review, 2026-09-30. Branch: `codex/monitoring-quickpass-001`.
Baseline: `e2d0c8b0182d9f556cbe2845634e6e8eaddf2a42` (fetched `origin/main`).
Exactly three gaps patched; no hosted configuration or business behavior changed.
No push, PR, merge or deployment. Android and the owner-tested native document
workflow are unchanged. The Pilot runbook remains authoritative: synthetic
PRE-PILOT REHEARSAL only; real-customer GO and recovery verification remain gated.

## Findings and evidence

Line references are to this branch unless explicitly marked baseline.

| Classification | Evidence | Decision |
|---|---|---|
| CONFIRMED GAP — fixed | Baseline `src/app/[locale]/error.tsx:44` explicitly logged the raw Error in browser console. Current `:28`, `:48` | Removed that effect. Kept AR/HE/EN screen, busy guard and refresh/reset transition. Browser console is not server log capture. |
| CONFIRMED GAP — fixed | Baseline had no application `src/instrumentation.ts`; installed Next 16.3.6 documents `onRequestError`. Current `src/instrumentation.ts:9`, `src/lib/monitoring/server-diagnostics.ts:38` | Added bounded application diagnostics for unexpected framework-reported server errors. Existing framework reporting is not claimed to have been absent. |
| CONFIRMED GAP — fixed | `src/lib/pdf/prepare-document.ts:34` caught document-recording exceptions silently at baseline `:33` | One fixed neutral warning, then the same 403. Normal inaccessible-order 404 remains silent. |
| ALREADY COVERED | `src/app/api/health/route.ts:13`, `:37`, `:47`, `:51`; tests `route.test.ts:26`, `:37`, `:75` | Dynamic, synchronous, no-store liveness/release identity. Production endpoint unchanged; strengthened existing HEAD test to assert empty body. |
| ALREADY COVERED | `src/lib/push/after-order.ts:12`, `:14`; `after-events.ts:12`, `:14`; `src/lib/data/push-delivery.ts:45`, `:56` | Fixed safe warnings and failure isolation already exist. No Push changes. Business notifications are not outage alerts. |
| ALREADY COVERED for failure detection; CONFIRMED GAP for raw-log safety — deferred | `src/lib/actions/orders.ts:129`, `:170`, `:217`; `src/lib/actions/inventory.ts:412` | Unexpected catches already log; known conflict/stock/locked/negative-stock outcomes return before logging. Raw Error logging needs a separate bounded pass; not forwarded into the new helper. |
| ALREADY COVERED for fallback; CONFIRMED GAP for raw-log safety — deferred | `src/lib/data/document-storage.ts:59`, `:134`, `:158`; PDF route `src/app/[locale]/admin/orders/[id]/documents/[type]/route.ts:130` | Existing storage diagnostics and stream fallback remain. Raw Error/message logs are not made safe by this new hook. |
| CONFIRMED GAP — deferred | `src/lib/data/token.ts:520`, `src/lib/data/catalog-showcase.ts:299`; actions `shop.ts:72`, `catalog-showcase.ts:162` | Returned RPC errors can bypass action catch logs. Need deliberate classification before logging; ordinary access/validation/no-row results share the null outcome. |
| OPTIONAL — deferred | `src/lib/data/document-storage.ts:97`, `:155`; `src/lib/data/push-events.ts:20`, `:71` | Silent signed-URL fallback and event-push budget exits. No optional-feature behavior changes or broad logger replacement. |
| NOT VERIFIED | Renderer `src/lib/pdf/render-document.ts:47`, `:97`; route `:95` | Render exceptions propagate to framework handling. New hook tested locally; no hosted failure or log-retention verification. |
| OPTIONAL — deferred | Runbook sections 9-b/9-c; current health tests | Existing manual health procedure suffices for this pass. No new smoke script, scheduled poll or production fault injection. |

The existing legal-provider logging helper at
`src/lib/legal-invoicing/provider/logging.ts` permits arbitrary redacted metadata;
it is not an adequate strict allowlist for these events. It remains unchanged.

## Diagnostics contract and operator access

`server-diagnostics.ts` constructs exactly eight fields: fixed event, fixed
severity, ISO timestamp, coarse environment/runtime, validated seven-character
release SHA (or `unknown`), fixed operation and exact allowlisted route template
(or `unknown`). Route-file suffixes/group names normalize only to known templates.
Actual paths, IDs, tokens, queries and unknown routes never become log fields.
There is no arbitrary metadata/Error/request/response/provider parameter.

| Event | Level | Meaning |
|---|---|---|
| `server_request_unexpected` | error | Next reported an unexpected request/render/action/proxy exception. Known route template helps group the symptom. |
| `document_record_unavailable` | warning | Document recording threw; existing safe 403 response retained. It does **not** establish an outage. |

`src/lib/data/supabase-writes.ts:216` wraps recording RPC failures without a typed
code. Access denial and an operational failure cannot reliably be distinguished
at the shared preparation catch. Both get the neutral warning, never an outage
label; validation/access early returns do not log. No message matching or
authorization changes were introduced to infer a cause.

Inspect local server stderr/console, or the deployment's existing Vercel function
logs **with authorized access**, filtering these fixed event names and release
SHA/time. Browser console output does not reach this sink. No external ingestion,
SDK, credential, queue or persistent diagnostic table was added.

Next redirect/not-found and dynamic-render control flow are excluded using its
installed documented `unstable_rethrow` classifier; the observer never changes
the response. The hook emits at most once per Error object (weak references), not
an exact request counter: deliberately reused Error objects can be undercounted.
Caught PDF failures do not reach the global hook and emit once at their call site.
Sink failure is swallowed without fallback logging, retries or recursion.

Blind spots: handled failures elsewhere, swallowed returned RPC errors, browser-
only exceptions/rejections, native Android failures, and optional-feature exits
listed above. Malformed classifier/context metadata can be dropped safely.
Framework/vendor default logs and existing raw console calls remain outside this
allowlist; this patch does not guarantee that all application/platform logs are
free of sensitive material. Do not export raw logs into incident reports.

## Hosted evidence and health limits

Read-only public check in this pass:

- `https://madaf-drab.vercel.app/api/health`: GET 200, exact expected safe payload,
  `environment=production`, `commit=e2d0c8b`, no-store; HEAD 200, empty body,
  no-store. **VERIFIED** liveness/release identity at the observation time.
- New diagnostics are **local only**, not deployed/hosted-verified.
- Control Room Runtime Errors request returned **403**. Logs, retention,
  historical failure rate and hosted sink delivery remain **UNVERIFIED**.
  No retry, alternate credential search or permission bypass was attempted.
- Database, Auth, Storage, order/inventory correctness, Push delivery and
  backup/PITR readiness are **not established** by health 200 or local tests.

Health GET/HEAD still perform no business-row reads or service-role operations.
Keep the runbook's release comparison and authenticated-screen checks; perform
mutating rehearsals only with authorized synthetic data, never real orders.

## Automatic alerts

**NOT CONFIGURED in repository:** `.github/workflows/ci.yml:10` triggers only on
main pushes/PRs; `vercel.json:1` contains region configuration only. No scheduled
uptime poll, crash-reporting transport or operational alert destination was found.
Existing CI is a release gate, not continuous availability monitoring.

**UNVERIFIED outside repository:** provider-side monitors, notification settings,
actual recipients, private support-owner roster, delivery/retention and quotas.
Runbook `:660`, `:734`, `:736` intentionally uses existing/manual sources; the
private operating copy supplies named owners and channels (`:942` onward).
Do not claim automatic monitoring is operational.

Minimal proposal, **activation pending Owner/Control Room approval**: one health
poll on existing GitHub Actions, three times daily initially, bounded HTTP timeout
and retry, fail on non-200/redirect/invalid safe payload, never print arbitrary
bodies. Use existing failed-workflow web/email notifications to a designated
technical owner; retain manual checks and release comparison. No new vendor or
account. Keep it within the existing included minutes; current remaining quota
is unknown, so zero cost is conditional on verifying the allowance first.
Scheduled notifications follow the workflow creator/cron modifier/re-enabler,
not every owner, and require enabled notification preferences.
Schedules can be delayed/dropped, so this is not a hard real-time alert guarantee.

Sources: [GitHub workflow notifications](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs),
[included usage](https://docs.github.com/en/billing/reference/product-usage-included),
[schedule limitations](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
Proposal only: no workflow, notification destination, account, billing setting or
hosted environment was changed and no alert was sent.

## Incident and rollback checklist

1. Follow [Pilot severity/response sections 10/10-b](../pilot/MONITORED-PILOT-LAUNCH-RUNBOOK.md).
   Notify the designated technical owner through the private support channel.
   P0: STOP immediately. P1: PAUSE affected workflow and freeze releases.
2. Record UTC time, fixed event, safe route template and release identity.
   Compare health commit with approved main. Do not attach raw URLs, request
   data, Error messages, signed links or customer information.
3. Inspect already-authorized logs. If access is denied/retention expired,
   record the evidence gap and escalate to Owner; do not bypass permissions.
4. Check the affected workflow with authorized synthetic fixtures. Reconcile
   ambiguous order success before any retry; preserve submission-key semantics.
   Distinguish expected access denial from an operational failure.
5. For an approved application rollback, restore the last approved deployment
   through the existing release process; or revert this small commit on a new
   reviewed branch. This task changes no schema/data, so no database rollback
   is part of it. Do not reset history or independently merge/deploy.
6. Recheck health identity and affected flow; document recovery with Control
   Room. Backup/PITR claims require the separate
   [recovery verification](../pilot/BACKUP_RESTORE_AND_RECOVERY.md).

## Changed files and verification

- `src/instrumentation.ts`: safe unexpected-server observer.
- `src/lib/monitoring/server-diagnostics.ts`: dependency-free allowlisted sink.
- `src/lib/monitoring/server-diagnostics.test.mts`: 12 synthetic logger/hook tests.
- `src/app/[locale]/error.tsx`: remove explicit raw browser Error logging only.
- `src/components/error-boundary-screen.test.tsx`: preserve retry/locale guards;
  require no boundary console logging.
- `src/lib/pdf/prepare-document.ts`: one neutral warning on existing catch.
- `src/lib/pdf/document-actions.test.mts`: warning privacy/count, early exits and
  throwing sink; existing Share/Print/Download responses retained.
- `src/app/api/health/route.test.ts`: existing HEAD test also asserts empty body.
- `package.json`: include monitoring tests in full suite; no dependency changes.
- This operations document.

Fresh local checks on CI-compatible Node 22.14.0:

| Check | Result |
|---|---|
| `git diff --check` | PASS |
| ESLint / `npx tsc --noEmit` | PASS / PASS |
| Focused monitoring / error boundary / health / document actions | PASS — 12 / 11 / 7 / 55 tests (85 total) |
| `npm test` | PASS — 1,583 tests; 0 failed/skipped/cancelled |
| `npm run test:timezone-matrix` | PASS — 7 tests |
| Standard `npm run build` | PASS — Next 16.3.6 Turbopack, deployment-safety check, 14 critical dynamic routes |
| Compiled production hook synthetic smoke | PASS — safe event, deduplication, redirect/not-found exclusion, sink failure |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |

No production fault, SMS, Push or customer mutation was used. Test/build logs
are local artifacts outside Git under `.codex/artifacts/monitoring-quickpass-001`.
AGENTS.md, its Next managed block and custom rules are unchanged after build.
No Android, native bridge, Firebase, document semantics, business mutation,
dependency, schema/auth/RLS, hosted configuration or operational GO change.
