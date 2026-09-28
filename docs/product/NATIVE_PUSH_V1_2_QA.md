# Native push V1.2 — local QA

Date: 2026-09-28. Node 22.14.0. All DB work used the disposable local
`madaf-push-qa` stack (DB loopback port 58622). No hosted tests, users, memberships,
migrations or notifications were created. Firebase transports in app tests are
stubbed and use synthetic configuration that cannot authenticate to Firebase.

## Final results

| Check | Result |
| --- | --- |
| `npm run test:push` (includes mounted notification settings) | PASS — 73 tests |
| `npm test` | PASS — 1,520 tests |
| New event/preference pgTAP file | PASS — 76 assertions |
| Existing push pgTAP file | PASS — 45 assertions |
| Full seeded DB suite | PASS — 1,283 assertions across 29 files |
| Two-connection live local low-stock claim test | PASS — one winner, one empty replay |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |
| `npm run build` — standard Turbopack | PASS |
| Critical dynamic-route build gate | PASS — 13 routes; new settings page also dynamic |
| `npm run test:timezone-matrix` | PASS — 7 matrix tests |
| Local deployment-safety matrix | PASS — 10 cases |
| Local timezone catalog check | PASS — 418 selectable zones |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 vulnerabilities |
| Local DB security/performance advisors | No findings |
| Local SQL lint | No new findings; existing unused `v_locked` warning in `create_tenant_with_owner` |
| Additive migration replay | PASS — all 66 migrations applied from a clean local DB |
| Local migration history | Parity at `20260928141506`; no hosted parity claimed |

Migration work was iterated without hosted access, checked with local advisors,
and inspected through a CLI-generated local schema pull. The ordered migration
retains baseline data initialization (which a schema-only diff cannot capture).
It was then replayed from scratch with the existing migrations; generated DB
types came from the local Supabase generator. Standard synthetic seed fixtures
were loaded before the full DB suite. An earlier no-seed run correctly failed
existing seed-dependent tests; the final seeded run above is green. The existing
app migration-count assertion now includes the separately approved V1.2 migration.

## Coverage

- Each event: exact A owner/admin devices included; preference-OFF, sales rep,
  B owner, expired/revoked session, banned/anonymous user, disabled device,
  demoted admin excluded. B events return only B-registered eligible devices.
  A multi-tenant user's installation registered in B receives no A event.
- Both owner devices share preference changes. Missing preferences resolve
  true/true/true/false; actual original new-order recipient RPC respects OFF/ON.
- Preference RPC own read/save/repeated save, malformed boolean, cross-tenant
  spoof and wrong/revoked session. Server action rejects extra tenant/user keys,
  unauthenticated/membership-less/sales-rep requests and stale account/tenant view
  scopes. Failed reads do not fall back to writable defaults.
- Settings page owner/admin gates and mock preview; all three languages have
  mounted switch, saving, saved, error, retry and transport-error assertions.
  Scope-key remount discards the previous supplier's unsaved values/status.
- Signup exact insertion identity, neutral visitor result, invalid/rejected
  request no scheduling, claim replay suppression and legacy boolean compatibility.
- Status committed history/actor identity, no-op and failed mutation suppression,
  later status progression, actor's multiple devices excluded, duplicate claim.
- Stock initial baseline, equality/threshold crossing, low→lower suppression,
  recovery/reset, recrossing, delayed multiple generations, authoritative current
  quantity, stale recovered-event suppression, rollback and exact concurrent claim.
  Removed order products come from the committed movement ledger. Synthetic
  bookkeeping failure proves stock still commits.
- All six data-layer mutation wrappers schedule only after RPC success. Failed
  product/inventory/stock/order mutations schedule none. No caller order-line
  list supplies notification recipients or inventory authorization.
- Safe localized event messages, bounded control/bidi sanitization, invalid-locale
  fallback, validated relative deep links, no extra payload fields, exact invalid
  token cleanup, disabled feature and schedule/provider failure isolation.

## Browser and acceptance limits

Local production mock-preview UI was visually checked in the in-app browser:
Arabic 390×844, Hebrew 390×844 and 1440×900, English 768×1024. All showed four
readable cards, no horizontal document overflow, and correct RTL/LTR ordering.
Switch targets measured 48×44 pixels. Mobile menu exposed Notifications with the
active navigation treatment. Mock mode's disabled controls and demo notice are
intentional; mounted tests exercised enabled save behavior, and local DB tests
exercised persistence/security separately.

Physical Android reception, two-device/two-tenant delivery and native preference
acceptance are **not tested** by this local bundle. No production notification was
sent. Delivery remains best-effort and at-most-once, with fail-open capture and
bounded callback limitations documented in [the architecture](NATIVE_PUSH_V1_2.md).

## Complete changed-file manifest

- `docs/product/NATIVE_PUSH_V1_2.md`
- `docs/product/NATIVE_PUSH_V1_2_QA.md`
- `package.json`
- `src/app/[locale]/admin/settings/notifications/page.tsx`
- `src/components/admin-shell.test.mts`
- `src/components/admin-shell.tsx`
- `src/components/admin/notification-settings.test.mts`
- `src/components/admin/notification-settings.tsx`
- `src/i18n/dictionaries/ar.ts`
- `src/i18n/dictionaries/en.ts`
- `src/i18n/dictionaries/he.ts`
- `src/i18n/types.ts`
- `src/lib/actions/push-preferences.ts`
- `src/lib/data/customer-signup.ts`
- `src/lib/data/push-events.live.test.ts`
- `src/lib/data/push-events.ts`
- `src/lib/data/push-preferences.ts`
- `src/lib/data/supabase-writes.ts`
- `src/lib/order-timeline.test.ts`
- `src/lib/push/after-events.ts`
- `src/lib/push/business-hooks.test.mts`
- `src/lib/push/event-delivery.test.mts`
- `src/lib/push/events.test.ts`
- `src/lib/push/firebase-sender.ts`
- `src/lib/push/preferences.test.mts`
- `src/lib/push/preferences.ts`
- `src/lib/push/settings-page.test.mts`
- `src/lib/supabase/database.types.ts`
- `supabase/migrations/20260928141506_native_push_preferences_events.sql`
- `supabase/tests/native_push_events.test.sql`
