# Native push backend V1 — local QA

2026-09-28. Branch `codex/native-push-backend-v1`, based on
`46560475589e7293b7ccec39a899ee69f8750fee` (`origin/main` at task start).
Node 22.14.0, Firebase Admin 14.5.0, Supabase CLI 2.107.0.

## Results

| Check | Result |
| --- | --- |
| `git diff --check` | PASS |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npm run test:push` | PASS — 24 tests |
| `npm test` | PASS — 1,466 tests, no skips |
| `npm run test:timezone-matrix` | PASS — 7 tests, exhaustive 418-zone matrix |
| `npm run build` | PASS — standard Turbopack production build |
| Critical dynamic-route checks | PASS — 13 routes; new devices API also dynamic |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| gaxios multipart with patched uuid | PASS — local fake adapter, no HTTP send |
| Fresh local migration replay | PASS — all 65 migrations and synthetic seed |
| Push pgTAP | PASS — 31 assertions |
| Full existing database suite | PASS — 28 files, 1,193 assertions |
| Database advisors (security/performance, warning+) | PASS — no issues |
| Database lint | No errors; pre-existing unused `v_locked` warning in `create_tenant_with_owner` |
| Generated database types | Match fresh local schema; generated, not hand-edited |
| Deployment-safety CLI synthetic matrix | PASS — 10 expected pass/fail scenarios |
| Timezone catalog vs local database | PASS — all 418 zones; script transport adapted only to isolated container/port |
| Local production HTTP smoke | Catalog 200; devices off 503/no-store; cross-origin POST 400 |
| Browser JS bundle boundary scan | No Firebase Admin/server credential references |
| `AGENTS.md` | Unchanged; custom rules intact after Next build/start |

The worktree uses its own installed `node_modules`, so the prior linked-modules
Turbopack limitation does not apply to this build. An existing shell test stub was
corrected to return the real logout result; the existing migration-count guard
now includes the one new migration. Neither guard was removed or bypassed.

Only the disposable local `madaf-push-qa` database (port 58622) received schema and
synthetic data. No hosted DB, Firebase account/configuration, Vercel environment,
Android source/APK, or real customer/order was changed. Test transports use synthetic
tokens and mock responses. Provider authentication, real FCM delivery, Android
display/tap and hosted logout remain **unverified at the credential/release gate**.

## Changed-file inventory

- `.env.example` — server-only push configuration template, default off.
- `.gitignore` — Firebase service-account download exclusions.
- `package.json`, `package-lock.json` — official sender SDK, patched uuid override, test script.
- `src/app/[locale]/layout.tsx` — invisible locale-only client registration child.
- `src/app/api/mobile/devices/route.ts` — authenticated registration/status/unregister API.
- `src/components/push/native-push-registration.tsx` — lifecycle mount/resume.
- `src/components/auth/logout-button.tsx` — pause/resume sync around logout.
- `src/components/admin-shell.test.mts` — accurate logout result fixture.
- `src/i18n/types.ts` — typed push title.
- `src/i18n/dictionaries/ar.ts`, `he.ts`, `en.ts` — localized push title.
- `src/lib/actions/auth.ts` — device cleanup and checked sign-out result.
- `src/lib/client/native-push.ts` — private bridge/token sync lifecycle.
- `src/lib/client/native-push.test.ts` — native/ordinary browser regression tests.
- `src/lib/data/push-devices.ts` — verified session/tenant and registration DAL.
- `src/lib/data/push-delivery.ts` — service-only committed-order dispatch DAL.
- `src/lib/data/supabase-writes.ts` — successful authenticated order hook.
- `src/lib/data/token.ts` — successful private-link order hook.
- `src/lib/data/catalog-showcase.ts` — successful showcase guest order hook.
- `src/lib/push/after-order.ts` — isolated Next `after` scheduling.
- `src/lib/push/device-input.ts` — strict shared input shapes/validation.
- `src/lib/push/firebase-sender.ts` — server-only data messages and error classification.
- `src/lib/push/devices-api.test.mts` — auth/payload/secrecy/cleanup coverage.
- `src/lib/push/delivery.test.mts` — recipient dispatch/dedup/cleanup/failure isolation.
- `src/lib/push/firebase-sender.test.ts` — locale/bidi/path/error classification.
- `src/lib/push/order-hooks.test.mts` — all three hooks run after successful RPC only.
- `src/lib/push/logout.test.mts` — cleanup/sign-out order and failure handling.
- `src/lib/order-timeline.test.ts` — acknowledge additive migration count.
- `src/lib/supabase/database.types.ts` — regenerated public schema types.
- `supabase/migrations/20260928095749_native_push_devices.sql` — additive schema and guarded RPCs.
- `supabase/tests/native_push.test.sql` — real PostgreSQL security/lifecycle tests.
- `docs/product/NATIVE_PUSH_BACKEND_V1.md` — design, failure semantics and credential gate.
- `docs/product/NATIVE_PUSH_BACKEND_V1_QA.md` — this local verification record.

No push, merge or deployment performed. This milestone does not establish hosted
readiness or lift the monitored Pilot runbook's separate GO gates.
