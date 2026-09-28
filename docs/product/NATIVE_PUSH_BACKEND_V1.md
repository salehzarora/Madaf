# Native push backend V1

Status: local implementation for Control Room review. Hosted migration, credentials,
deployment and real-device end-to-end delivery are NOT verified or authorized by
this document. The Pilot runbook's existing real-customer GO block remains intact.

## Flow and boundary

Android `app.madaf.android.dev` retains its private FCM token and exact-origin
`MadafNative` channel. No Android code changes or direct Android Supabase writes.

Native token → authenticated Web API → session-bound `push_devices` → committed
order follow-up → server-only Firebase Admin → Android validated relative deep link.

The invisible locale-layout client child receives only `locale`; the layout and
AppShell remain Server Components. Ordinary browsers without the bridge do no
registration requests, storage writes or polling. No notification settings UI,
new notification categories or permission prompts are introduced.

## Database and authorization

Additive migration: `20260928095749_native_push_devices.sql`.

- `push_devices`: UUID ID, tenant/user membership FK, live `auth.sessions` FK,
  unique installation UUID and token, Android platform, AR/HE/EN locale, enabled,
  created/updated/last-seen timestamps. Session or membership removal cascades the
  association. Tenant/enabled, session and membership indexes support reads/FKs.
- `push_order_dispatches`: order PK/FK and claimed timestamp, no token/payload
  snapshot. It suppresses duplicate application dispatches across ID/public-ref
  retries of the existing idempotent order submission paths.
- Both tables have RLS enabled with **no client policies and no anon/authenticated
  table grants**. Even the registrant cannot list tokens. Service role has device
  CRUD and dispatch select/insert only.
- Authenticated `register_push_device` and `disable_my_push_device` RPCs use
  `auth.uid()` and JWT `session_id`; registration verifies current tenant membership,
  session ownership/presence/expiry, non-anonymous user and non-banned status.
  Roles derive from `tenant_users`, not user metadata. Registration supports all
  current member roles; only owner/admin can receive V1 alerts.
- Reassociation is serialized under an advisory lock. The installation UUID alone
  is not authorization: changing another user's existing binding requires the
  same private FCM token. A current owner can rotate the token normally. Device
  quota is 20 rows/user; token refresh and same-token storage resets deduplicate.
- Claim, recipient and invalid-token cleanup RPCs are service-role-only, also
  protected by `assert_service_role`. All new definer functions use an empty
  search path and qualified names. Existing order RPCs/triggers/RLS are unchanged.

One installation has one active user and **selected tenant** association. A
session/user/tenant change causes resync; locale changes remount it. If the tenant
changes between an alert and a tap, the existing protected order page may be
unavailable until the correct tenant is selected. No cross-tenant bypass or
automatic tenant switching is added.

## API, bridge and logout

`/api/mobile/devices` is a dynamic Node route, same-origin, no-store:

- `GET`: authenticated opaque sync scope only (hash of verified user/session/
  tenant); no token enumeration. Feature off returns 503, no session returns 401.
- `POST`: strict `{installationId, platform:"android", token, locale, enabled}`;
  unknown fields, user/tenant IDs, invalid values, foreign Origin and bodies over
  8 KiB are rejected. Server derives tenant using existing verified session and
  membership selection, then invokes the authenticated RPC. Returns `{ok:true}`.
- `DELETE`: strict `{installationId}`; disables only caller/session-owned
  association. Available even if the feature flag is off. No global SDK token deletion.

Only a random installation UUID is stored in browser localStorage. The token stays
in native private storage and transient JS memory/HTTPS request body. The httpOnly,
SameSite=Strict, secure-in-production installation cookie carries **no FCM token**.
It is an identifier for server logout cleanup, never authentication.

Bridge messages correlate IDs and types with 5-second timeouts. Sync waits for an
authenticated API response before `getCapabilities` and `getPushRegistration`.
In-memory scope/token dedup prevents repeat registration on renders. Foreground
and 30-second polling detect rotation; failures back off up to 5 minutes. Requests
have an 8-second abort timeout. Nothing logs tokens, provider details or payloads.
Native `registered` means token obtained; it does **not** prove OS notification
permission is granted.

Logout pauses/cancels browser sync, disables the current association before the
existing global Supabase sign-out, and checks sign-out's returned error. Failure
resumes sync instead of claiming success. Cleanup failure does not block sign-out:
session revocation/cascade prevents late registration with a stale JWT. Already
queued FCM notifications cannot be withdrawn on logout; the tapped order page
still requires normal auth and tenant authorization.

## Post-commit delivery

The exact hooks are after successful RPC responses in `sbCreateOrderRequest`,
`submitTokenOrder` and `submitShowcaseGuestOrder`. Authenticated order uses its
committed ID; public-link flows use only the returned public reference. Failure
paths schedule nothing. No additional order creation path or submission key change.

`next/server.after()` schedules isolated delivery. Both scheduling errors and
callback failures are caught with fixed safe diagnostics. The Firebase code never
runs inside the order database transaction and its result is not returned to the
customer. **A push failure cannot roll back or fail a committed order.**

With the feature enabled and credentials configured, the server claims a committed
`new` order created within 15 minutes. Claim is unique per order. Recipient queries
page 100 at a time and recheck current same-tenant owner/admin membership, enabled
device, live owned session, session expiry and user ban/anonymous status. There is
no sales-rep, other-tenant or anonymous recipient fallback.

Firebase Admin `sendEach` sends data-only `{title, body, path}`. AR/HE/EN typed
dictionaries provide “New order”; body contains only the sanitized internal
`MDF-...` number (no shop/customer PII, totals or notes). Path is validated UUID plus
supported locale: `/{locale}/admin/orders/{id}`. Unknown locale defaults to Hebrew.
No URL, `notification` block, topic fanout or per-order collapse key is sent.
Android priority is high with a 15-minute TTL. Existing Android validation remains
authoritative on receipt/tap.

This is **best-effort**, not a durable outbox or guaranteed exactly-once delivery.
One application claim suppresses repeated submission dispatch; an interrupted
request before `after`, crash after claim, provider failure, no eligible device,
status advance before claim or exhausted server runtime may lose an alert. The
25-second loop budget is soft, checked between batches; SDK retries or cleanup can
run longer. SDK/provider retries may also duplicate visible delivery. No automatic
reclaim/replay is supplied. Orders remain authoritative in the admin UI.

Invalid cleanup is compare-and-disable by **device ID + exact attempted token**.
Only `messaging/registration-token-not-registered` and
`messaging/invalid-registration-token` disable. `invalid-argument`, auth/project
mismatch, quota, server/network failures retain registrations. A rotated token is
not disabled by a late failure for the old token. Logs contain fixed diagnostics
and aggregate counts only.

## Credential gate and controlled activation

No Firebase sender credentials have been created/read/added in this milestone.
The Android `google-services.json` is client identity, **not** a sender credential.

Owner action, when Control Room approves credential preparation:

1. Select project **madafdev-35599** in Google Cloud. Confirm Firebase Cloud
   Messaging API (HTTP v1) is enabled.
2. Create a dedicated service account (for example `madaf-push-sender`) under
   IAM & Admin → Service Accounts. Grant **Firebase Cloud Messaging API Admin**
   (`roles/firebasecloudmessaging.admin`) in that project; no Owner/Editor role.
3. For that account, Keys → Add key → Create new key → JSON. Store the downloaded
   file securely outside both repositories. Do not paste its private key in chat,
   source, screenshots, logs or Android resources. If organizational policy blocks
   keys, stop for a workload-identity design; do not weaken the policy.
4. After separate hosted approval, add the following to the specifically approved
   Vercel environment as server-only variables, never `NEXT_PUBLIC_*`:

| Variable | Value/source |
| --- | --- |
| `MADAF_NATIVE_PUSH_ENABLED` | `false` until migration/configuration/QA approved; then `true` |
| `FIREBASE_PROJECT_ID` | `madafdev-35599` (sender pins this project) |
| `FIREBASE_CLIENT_EMAIL` | JSON `client_email` |
| `FIREBASE_PRIVATE_KEY` | JSON `private_key`; actual newlines or escaped `\n` supported |
| `SUPABASE_SERVICE_ROLE_KEY` | Existing server-only key for the approved MADAF Supabase project |
| `NEXT_PUBLIC_SUPABASE_URL` | Existing approved backend URL; no backend retargeting |

Do not broadly enable preview sends against a live tenant. Local/tests use only
synthetic fixtures and mocked transports. Hosted migration application, credential
addition, deploy and a real-device test order remain separate approval gates.
Smoke test the three order paths, idempotent retries, owner/admin-only delivery,
deep-link auth, logout, token rotation and transient failure isolation using only
synthetic data before claiming hosted success.

Dependency: exact `firebase-admin@14.5.0`, Node 22+. Firebase's optional Storage
dependency currently pulls gaxios 6 → uuid 9. A `uuid:11.1.1` override patches
GHSA-w5hq-g745-h8pq while retaining the CommonJS `v4()` API used by gaxios. No
Firestore/Storage features are used. Review/remove this override when upstream
resolves it; production audit must remain green.

## Verification and references

`npm run test:push` covers authenticated API, spoof rejection, no token leakage,
bridge lifecycle/backoff/rotation/logout, correct post-commit hook ordering,
safe message paths, exact invalid cleanup and isolated scheduling/sender failures.
`supabase/tests/native_push.test.sql` runs actual PostgreSQL authorization,
ownership, upsert/refresh, recipient-role/tenant/session, claim and cleanup tests.
The existing migration-count guard now includes this one additive migration;
the shell logout fixture returns its real `{ok:true}` result shape.

- [Firebase Admin setup](https://firebase.google.com/docs/admin/setup)
- [FCM send and authorization](https://firebase.google.com/docs/cloud-messaging/send/admin-sdk)
- [Firebase IAM roles](https://firebase.google.com/docs/projects/iam/roles-predefined-product)
- [FCM error classification](https://firebase.google.com/docs/cloud-messaging/error-codes)
- [Collapse behavior](https://firebase.google.com/docs/cloud-messaging/customize-messages/collapsible-message-types)
- [uuid security advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq)
