# Native push polish V1.1 — local verification

2026-09-28. Base `650e58da4412f119a1ca73ea8859b98905775c00`.
Branch `codex/native-push-v1-1-polish`. Node 22.14.0; Supabase CLI 2.107.0.

| Check | Result |
| --- | --- |
| `git diff --check` | PASS |
| `npm run test:push` | PASS — 33 tests, including mounted registration and stubbed SDK transport |
| `npm run test:locale` | PASS — 5 tests, including mounted compact/segmented switchers |
| `npm test` | PASS — 1,480 tests, no skips |
| Focused local pgTAP | PASS — 45 assertions |
| Full local pgTAP | PASS — 28 files, 1,207 assertions |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run build` | PASS — standard Turbopack production build |
| Critical dynamic-route guard | PASS — 13 routes |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| Timezone matrix | PASS — 7 tests, exhaustive 418-zone matrix |
| Deployment-safety synthetic matrix | PASS — 10 expected pass/fail cases |
| Local database timezone catalog | PASS — all 418 selectable timezones |
| Local production HTTP | PASS — missing/ar/en/invalid cookie redirects, query preservation, cache headers and explicit locale precedence |
| Actual local PostgREST summary projection | PASS — HTTP 200 with only `customer_name` and `subtotal` keys; no row values logged |
| Read-only diff review | No actionable findings |
| `AGENTS.md` | Unchanged; custom rules intact after Next build/start |

Database commands explicitly used `--local --workdir` against the disposable
`madaf-push-qa` project at port 58622, with tests loaded from this worktree.
No `--linked`, hosted SQL, migration repair or db push was used for this milestone.
No migration/schema change was needed. All new synthetic pgTAP fixtures roll back.
Existing exact-token cleanup, order idempotency and post-commit failure-isolation
tests remain active.

The first app-suite pass identified a missing `useSearchParams` admin-shell mock;
that fixture was updated to match the component's new dependency. The final suite
passes. Firebase transport coverage uses an in-memory SDK instance, a throwing
fake credential provider and a stubbed `sendEach`; it never authenticates or sends.
Production code does not contain test configuration.

The production build used this worktree's own node_modules and required no Webpack
fallback. Local HTTP verification used port 3014 in mock mode. Neither local HTTP
nor unit tests establish real Android restart behavior or real FCM delivery. The
[two-device acceptance plan](NATIVE_PUSH_POLISH_V1_1.md#real-two-tenant-android-acceptance-procedure--prepared-not-performed)
is prepared for Control Room and was not performed against hosted accounts.

## Changed files

Runtime:

- `src/proxy.ts` — validated saved-locale redirects, private no-store/Vary behavior.
- `src/i18n/locale-preference.ts` — host-only, non-sensitive locale cookie writer.
- `src/components/locale-switcher.tsx` — persist before navigation; query preservation in a leaf Suspense boundary.
- `src/lib/data/push-delivery.ts` — optional safe summary lookup after claim.
- `src/lib/push/firebase-sender.ts` — sanitized business name, order number and formatted subtotal, safe fallback.

Tests and test commands:

- `package.json` — integrate locale and mounted registration suites; no dependency changes.
- `src/proxy.test.ts` — locale precedence/default/query/cache matrix.
- `src/components/locale-switcher.test.tsx` — both variants, cookie properties and synchronous ordering.
- `src/components/admin-shell.test.mts` — add the required search-params mock.
- `src/components/push/native-push-registration.test.tsx` — real mounted locale resync.
- `src/lib/client/native-push.test.ts` — stable installation/token across locale sync lifecycles.
- `src/lib/push/delivery.test.mts` — narrow projection, claimed ID, enrichment fallback and post-commit error isolation.
- `src/lib/push/firebase-sender.test.ts` — localized safe content, sanitization and render fallback.
- `src/lib/push/firebase-transport.test.mts` — next send uses the device locale and unchanged data-only contract.
- `supabase/tests/native_push.test.sql` — exact two-tenant recipient identity, eligibility, locale and reassociation assertions.

Documentation:

- `docs/I18N_RTL_GUIDE.md` — persisted UI preference and resolved query limitation.
- `docs/product/NATIVE_PUSH_BACKEND_V1.md` — updated message contract.
- `docs/product/NATIVE_PUSH_POLISH_V1_1.md` — architecture, matrix and prepared real-device plan.
- `docs/product/NATIVE_PUSH_POLISH_V1_1_QA.md` — this evidence record.

Hosted changes: **NO**. Android changes: **NO**. New credentials/secrets: **NO**.
Domains, Firebase project, feature activation, RLS, auth, business/order logic,
dependencies and migration files are unchanged. No push, merge or deployment.
