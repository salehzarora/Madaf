# Database client privilege closure

This patch restores the existing RPC-only mutation boundary. It changes grants
and future-object defaults, not RLS, data, function bodies or application behavior.
It is prepared for Control Room review; hosted application is a separate gate.
Real-customer GO remains unauthorized.

## Evidence and application requirements

Read-only hosted inspection on 2026-10-05 confirmed the following on project
`xcfjxgdfgjvsqkhuiczu`. The designated QA tenant remained active at epoch 6.
PUBLIC/anon had no direct privileges on the four tables or three sequences.

| Object | Authenticated before | Authenticated after local migration |
| --- | --- | --- |
| audit_events | SELECT, INSERT, UPDATE, DELETE | SELECT |
| order_status_history | SELECT, INSERT, UPDATE, DELETE | SELECT |
| documents | SELECT, INSERT, UPDATE, DELETE | SELECT |
| tenants | SELECT, INSERT, DELETE | SELECT |
| audit_events_id_seq | USAGE, SELECT, UPDATE | none |
| token_access_attempts_id_seq | USAGE, SELECT, UPDATE | none |
| legal_document_events_id_seq | USAGE, SELECT, UPDATE | none |

The 11 direct table write grants were surplus; current RLS already denied the
writes. No active exploit was demonstrated. Owner/service privileges stay intact.
The four tables had no column ACLs; tests also deny effective column-only write
privileges so a future column grant cannot silently bypass the table boundary.

- `src/lib/data/supabase-reads.ts` reads audits, documents and tenant settings.
  Existing authenticated SELECT/RLS is retained, including history compatibility.
- `src/lib/data/supabase-writes.ts` uses protected order, document and settings
  RPCs. `src/lib/actions/tenant.ts` uses `create_tenant_with_owner`.
- `src/lib/data/pricing.ts`, `token.ts` and `catalog-showcase.ts` use their
  reviewed pricing/token APIs. No normal application direct table mutation or
  sequence access was found. Direct service-client writes in live fixture tests
  are not authenticated application dependencies.

## Internal function disposition

All six functions are postgres-owned, pin an empty search_path and serve internal
trigger/writer use. PUBLIC/anon/authenticated EXECUTE is removed individually;
explicit service_role EXECUTE is retained, including local installations that
previously inherited service access through PUBLIC.

| Function | Required internal use |
| --- | --- |
| log_order_status_change() | SECURITY DEFINER order-status history trigger |
| _gen_order_public_ref() | Random reference generator called by the order trigger |
| _orders_set_public_ref() | BEFORE INSERT order-reference trigger |
| set_updated_at() | Existing timestamp triggers |
| _legal_documents_guard_immutable() | Inert legal-document immutability guard |
| _sandbox_writeonce_guard() | Sandbox archival/signing write-once guards |

No intentional API grant is revoked. Existing token catalog, Showcase, token
order creation, token resolve/quote and signup entry points retain their ACLs.
The local migration-preservation check compares all other function ACLs, all
function bodies, all public RLS policies and service table privileges.

## Future-object defaults

No application migration introduced these defaults. The installed Supabase
Postgres image `17.6.1.136` contains the vendor initializer at
`/docker-entrypoint-initdb.d/init-scripts/00000000000000-initial-schema.sql`:
lines 40–42 grant ALL on future public tables/functions/sequences; lines 51–56
repeat this for supabase_admin. The corresponding upstream source is
[Supabase's initial schema](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000000-initial-schema.sql).

The hosted inventory has 39 public tables and three sequences, all postgres-owned.
The migration targets that application creator explicitly:

- postgres/public future tables and sequences receive no implicit client grants;
- postgres/public future functions receive no explicit anon/authenticated grants;
- postgres-owned future functions also lose the global implicit PUBLIC EXECUTE
  default. Schema-only revocation cannot remove that global default, as explained
  in [PostgreSQL's default-privilege documentation](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).

The global function change affects future postgres-created functions in other
schemas too. Any intended exposure must be explicitly granted. Existing functions
are unaffected. Existing public service defaults are preserved.

supabase_admin defaults are a separate platform-owned surface: the hosted
postgres session is not a member of that role and cannot administer its defaults.
This patch does not attempt to bypass that boundary or change managed schemas.
Objects created later under another owner require their own exposure review;
postgres default closure must not be represented as closure for every owner.

## Regression coverage

`supabase/tests/security_grants_closure.test.sql` verifies effective grant
denial, real client INSERT/UPDATE/DELETE and sequence allocation/reset denial,
service access, future objects created as postgres, and preserved internal
reference/history/audit writers. It exercises authenticated creation, editing,
status changes and invoice-draft generation/regeneration after helper revocation.

The existing DB suite covers onboarding/settings, pricing management and orders,
private shop, Showcase, signup, immutability and audit boundaries. The Push test's
temporary UUID fixture now grants its required authenticated EXECUTE explicitly;
it no longer relies on the removed global PUBLIC default. The application
timeline test's historical migration-count snapshot includes this additive
migration. Neither adjustment changes production logic.

## Fresh local verification

Node 22.23.3 and the pinned Supabase CLI 2.107.0 were used. Dependencies were
installed physically in the isolated worktree; no lockfile or dependency change.

| Check | Result |
| --- | --- |
| Focused effective grants, future objects, writers/documents | PASS — 262 assertions |
| Full pgTAP database suite | PASS — 1,638 assertions in 32 files |
| Full application suite | PASS — 1,636 tests; no skips |
| Authenticated pricing | PASS — 65 checks |
| Pricing forced concurrency | PASS — 16 checks |
| Real token/private-shop/Showcase paths | PASS — 21 checks |
| Writer concurrency/idempotency | PASS — 19 tests; no skips |
| Chromium journeys | PASS — 18 tests; one worker, zero retries |
| Process/Docker guards | PASS — 22 tests; one POSIX-only case inapplicable on Windows |
| Lint / typecheck / diff check | PASS |
| Standard Turbopack production build | PASS |
| Critical dynamic routes | PASS — 14 |
| Exhaustive timezone matrix | PASS — 7 tests |
| Production dependency audit | PASS — 0 vulnerabilities |
| Generated database types | Regenerated locally; byte-equivalent after newline normalization |
| Owned local backend cleanup | PASS; unrelated stacks not reset or stopped |

The SQL test runner first recreated the confirmed legacy grant residues in its
own disposable database, then applied the migration. Preservation checks compare
actual before/after policies, API ACLs, function bodies and service table
privileges. Full-suite fixture seeding and synthetic concurrency affect only
owned local stacks. No hosted write or production acceptance is claimed.

## Finding disposition and release limits

| Classification | Finding |
| --- | --- |
| RESOLVED locally; hosted apply pending | 11 surplus table writes; three client sequence ACLs; six helper ACLs; postgres application defaults |
| EXPECTED | Explicit guarded authenticated and token/shop/Showcase/signup API entry points; service and owner permissions |
| DEFERRED | Platform-owned supabase_admin future defaults; leaked-password policy/configuration; full monitoring/alert acceptance |
| OUT OF SCOPE | Performance advisor recommendations |
| BLOCKING for real-customer GO | Hosted permission application/verification and remaining first-pilot onboarding/operator/recovery/Control Room gates |

Fresh hosted security-advisor read-back still describes the unmodified hosted
schema, not an applied patch. Its 15
[RLS-without-policy findings](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
are expected deny-by-default tables reached through trusted writers/guarded APIs.
The nine [anon definer findings](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable)
include eight intentional token/signup APIs and log_order_status_change.
The 68 [authenticated definer findings](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
include the same unnecessary trigger exposure and 67 existing guarded APIs or
authorization/policy helpers. Only the trigger exposure is closed here.
[Leaked-password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
remains disabled and deferred to separate policy/configuration review.

No hosted migration, pricing-state change, authentication change, billing change,
manual deployment or real-customer data is part of this patch. The first-pilot
Free/Nano exception remains policy: backup/PITR is deferred under accepted risk,
not PASS; email/password is approved and Phone OTP remains deferred/not run.
Absi Shibsi remains QA/SMOKE and must not be converted into a real-customer tenant.
