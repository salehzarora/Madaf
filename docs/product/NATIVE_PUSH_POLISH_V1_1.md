# Native push polish V1.1

Local review bundle based on `650e58da4412f119a1ca73ea8859b98905775c00`.
Branch: `codex/native-push-v1-1-polish`. One consolidated local commit; no push,
hosted mutation, migration, Android change or release activation in this task.
This document does not lift the Pilot runbook's real-customer GO gate.

## Authorization and exact-identity coverage

The existing server derives the user/session and selected tenant. Registration's
guarded RPC checks live session ownership and membership. The service-only sender
claims a committed order, then the recipient RPC joins `orders.tenant_id` to
`push_devices.tenant_id`, current `tenant_users` owner/admin membership,
`auth.sessions` ownership/expiry and `auth.users` eligibility. Devices must be
enabled. Neither client fields nor the installation identifier grant access.
RLS, grants, RPC definitions and all migrations remain unchanged.

The transaction-scoped pgTAP fixtures assert exact device IDs, not just counts:

| Scenario | Expected recipient identity |
| --- | --- |
| Tenant A order | A owner + A admin; excludes A sales rep and B owner |
| Tenant B order | B owner only; excludes every A device |
| Expired A admin session | A owner only |
| Banned A admin | A owner only |
| A admin demoted to sales rep | A owner only |
| Disabled A admin device | A owner only |
| Exact invalid A owner token | A admin only; stale old-token failure keeps refreshed token |
| Revoked sessions | Removed associations never return; B owner remains eligible for B |
| Cross-tenant registration spoof | Rejected; API also rejects caller-supplied user/tenant fields |
| Token refresh | One association with the replacement token |
| he → ar → en | Exact same device ID, installation and token; locale updated, one row |
| Multi-tenant user's installation associated with A | A delivery only, despite membership in B |
| Same installation reassociated with B | B delivery only, same ID/token and one association |

Existing claim idempotency, client-table denial, service-role-only execution,
logout and late-registration-after-revocation tests remain in force.

## Locale preference

`madaf_locale` stores only `ar`, `he` or `en`, host-only, `Path=/`, `SameSite=Lax`,
one-year Max-Age and `Secure` on HTTPS. Both locale switchers write synchronously
before navigation and keep query parameters. Cookie failures do not block the
current selection. Query hooks remain in a small Suspense boundary within the
switcher; no server shell was converted to a client component.

Only unprefixed requests use the validated cookie. Missing/invalid values use
Hebrew. Explicit `/ar`, `/he` and `/en` URLs win over the cookie. Cookie-dependent
redirects are `private, no-store` and `Vary: Cookie`, preventing shared-cache reuse.
The manifest/default locale stays Hebrew. No Android-side locale storage added.

The mounted `NativePushRegistration` restarts sync on locale changes. Browser
tests prove stable installation/token requests; pgTAP proves the existing upsert
changes one row; the mocked SDK transport proves the next message uses the
registered locale for title, currency and `/{locale}/admin/orders/{orderId}`.

## Safe notification summary and failure behavior

After claim succeeds, the server-only DAL selects **only** `subtotal` and
`customer_name:customer_snapshot->>name` for the claimed order ID. The snapshot
keeps the business name from order creation and supports guest orders without a
customer association. It does not fetch phone, email, address, notes or the full
snapshot. Recipient authorization still runs independently at send time.

Names have control/format characters, bidi overrides and line breaks removed,
whitespace normalized and an 80-Unicode-code-point cap. The strict existing
order-number validation is preserved. Subtotals must be numeric, finite and
non-negative, and use the existing MADAF ILS formatter (up to two decimals).
Visible fields are isolated for bidirectional rendering. UUID exists only in the
validated navigation path, not title/body. No extra notification data fields.

Illustrative names and numbers (actual currency placement follows locale):

| Language | Title | Visible body |
| --- | --- | --- |
| AR | طلب جديد | بقالة الواحة · MDF-1036 · 54.25 ₪ |
| HE | הזמנה חדשה | מכולת נווה · MDF-1036 · 54.25 ₪ |
| EN | New order | Oasis Grocery · MDF-1036 · ₪54.25 |

Missing/invalid names or subtotal, failed lookup or failed currency formatting
fall back to the previous title + order-number body. A failed claim sends
nothing. The unchanged post-commit scheduler catches delivery/provider/cleanup
exceptions so push cannot fail or roll back the order. Exact-token permanent-error
cleanup and best-effort dispatch semantics remain unchanged.

## Real two-tenant Android acceptance procedure — prepared, not performed

Use two separate existing installations/devices and owner-authorized accounts.
Use only synthetic shops/orders in the approved rehearsal environment. Do not
create accounts, reset passwords or edit hosted memberships to enable this test.
If an eligible second supplier account is unavailable, stop that acceptance test
and report the missing authorized account.

1. Confirm the reviewed web release and existing Android build are the intended
   versions. Control Room separately controls feature/configuration activation;
   this procedure does not authorize changes to Firebase or hosted settings.
2. Device A: sign in to **Absi Shibsi / عبسي شيبسي** with an eligible owner/admin
   account. Device B: sign in to another authorized supplier, e.g. existing
   **lolo bas** only if the owner has valid credentials. Confirm each visible
   tenant before proceeding. Ensure OS notifications are allowed on both.
3. Select Arabic on A and Hebrew on B. Close/reopen each app through its normal
   root launch. A must reopen in Arabic, B in Hebrew. Select English on A and
   repeat; it must reopen in English. Return A to Arabic. A fresh cookie jar must
   use Hebrew. Do not clear real account data just to run the first-use check.
4. After authenticated registration sync completes, use an approved read-only
   inspection to confirm each installation has exactly one enabled association
   with its own tenant and chosen locale. Never copy/log raw FCM tokens.
5. Submit one synthetic order for Absi Shibsi through an existing approved order
   flow. Confirm **A receives ONE**, **B receives ZERO**. On A, check Arabic title,
   safe business name, correct order number/subtotal, and tap to the authorized
   Arabic order detail. Confirm no contact details or notes appear.
6. Submit one synthetic order for the second supplier. Confirm **B receives ONE**,
   **A receives ZERO**. Verify Hebrew text/currency and the authorized Hebrew path.
7. Change B to English, allow resync, restart and submit a new second-supplier
   synthetic order. Verify English notification/path, still one device row and
   no notification on A. Retry a previous order submission: no extra dispatch.
8. Record device/build versions, selected tenants/locales, safe order references,
   expected/actual receipt counts, delay and tap result. An absent notification is
   inconclusive for isolation unless the matching intended device received its
   notification; this remains best-effort delivery, not a guaranteed outbox.

Physical Android persistence, real provider delivery and these cross-device
observations remain **unverified** until Control Room executes this procedure.

## Local verification

Results and exact file inventory are recorded in `NATIVE_PUSH_POLISH_V1_1_QA.md`.
All DB work uses disposable local `madaf-push-qa` on port 58622. pgTAP test data
rolls back; no hosted account, device, order, configuration or migration changed.
