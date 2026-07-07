# Staging Runbook (M7C)

> Operational companion to [STAGING_DEPLOYMENT_M7C.md](STAGING_DEPLOYMENT_M7C.md).
> Monitoring setup, failure-mode triage, rollback/incident steps, and a safe
> demo-data plan for **staging**. No production, no secrets, no legal/payment
> activation.

---

## 1. Monitoring & logging (Scope H)

Set up before inviting anyone to staging. Placeholders — wire a provider of your
choice; none is committed.

- **Error reporting** *(placeholder)* — add a crash reporter (e.g. Sentry) via
  its env-based DSN in Vercel server env. Not integrated yet; capture server
  action + route errors and unhandled exceptions.
- **Uptime monitoring** *(placeholder)* — an external ping on the staging origin
  (`/he`) + an authenticated health path; alert on non-200 / latency.
- **Auth / SMS delivery monitoring** — watch Supabase **Auth logs** for OTP send
  failures and the **SMS provider dashboard** for delivery/spend. Alert on a
  spike in `sms_send_failed` or verification failures.
- **Supabase logs to check** — Auth logs (OTP send/verify), Postgres logs (RLS
  denials, RPC errors `MDF*`), Storage logs (signed-URL / object access),
  Advisors (Security/Performance).
- **Vercel logs to check** — Build logs (env/build failures), Function/Runtime
  logs (server action + route errors), the deployment's Runtime Errors panel.

## 2. Common failure modes & triage

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| **SMS not delivered** | provider not configured / spend cap / rate limit / wrong number format | check Supabase Auth log + provider dashboard; confirm Phone provider enabled + credentials in **dashboard secrets**; verify E.164 number; review rate limits |
| **Auth redirect mismatch** (login "works" then bounces) | Supabase Site/Redirect URL ≠ deployed origin | set Auth Site URL + Redirect URLs to the exact staging origin (and preview origins) |
| **Missing env var** (build/runtime error, mock fallback) | Vercel env not set / wrong scope | set §2 vars; server-only vars must NOT be `NEXT_PUBLIC`; run `assessDeploymentSafety()` |
| **Storage bucket missing** (no PDF download) | `documents`/`product-images` not created on hosted project | create both **private** buckets; confirm `documents` has no authenticated policies |
| **RLS denial** (empty lists / permission denied) | user has no membership / wrong tenant / anon | confirm `tenant_users` membership; owner/admin vs sales_rep scope; anon is expected to see nothing |
| **PDF generation failure** | pdfkit/font tracing missing in the deployed function | `serverExternalPackages` + `outputFileTracingIncludes` (next.config.ts) ship the fonts; check function logs; route falls back to streaming if storage is down |
| **Private link invalid/expired** | token revoked/expired, or mock mode | shop route 404s in mock; in supabase mode an invalid token shows the clean dead-end — issue a fresh link |

## 3. Rollback / incident checklist (Scope B7)

Fastest-to-slowest; do the ones relevant to the incident.

- [ ] **Disable the Vercel deployment** — promote the previous good deployment or
      pause the project (stops new traffic to the bad build).
- [ ] **Revoke / correct staging env vars** — remove a leaked or wrong value in
      Vercel; redeploy.
- [ ] **Rotate Supabase keys if leaked** — regenerate the anon + service-role
      keys in the Supabase dashboard; update Vercel env; redeploy. Treat any
      service-role exposure as an incident.
- [ ] **Disable the SMS provider** — turn off the provider / Phone provider in
      Supabase to stop OTP sends (and spend) during abuse.
- [ ] **Restore a DB backup** — use Supabase's point-in-time / backup restore for
      the staging project (never a `db reset` on hosted).
- [ ] **Disable tenant access links** — revoke active `customer_access_links`
      (owner/admin, `/admin/customers`) to cut off tokenized shop access.
- [ ] **Incident notes** — record what happened, blast radius, keys rotated, and
      follow-ups. Confirm legal/payment remained OFF throughout (they are, by
      construction).

## 4. Demo data & onboarding (Scope I)

- **No real customer data in staging.** Use obviously-fake tenants, shops, and
  phone numbers.
- **Do NOT run `supabase/bootstrap-auth.sql` against staging** — it seeds
  demo **email/password** users for the LOCAL stack only. Staging uses phone OTP.
- **Create a demo tenant** — sign in via phone OTP with a real staging number,
  then create the tenant at `/onboarding` (you become `owner`).
- **Seed products** — add manufacturers/categories/products/inventory through
  `/admin` (there is no destructive hosted seed script, and none should be
  added). The local `supabase/seed.sql` is for the **local** stack only.
- **Create private links** — `/admin/customers` → create an order link (token
  shown once) → open `/shop/<token>`.
- **Test the roles** — invite a teammate (email invite, requires
  `MADAF_EMAIL_AUTH_ENABLED=true`; see the AUTH doc limitation), set roles
  owner/admin/sales_rep, assign a sales_rep to specific customers, and confirm a
  sales_rep sees only assigned customers and can order only for them.

## 5. What staging must never do

- Never enable legal invoicing / numbering / a production provider mode; never
  flip `legal_effective`. See
  [../legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md](../legal-invoicing/PRODUCTION_ACTIVATION_REVIEW_CHECKLIST.md).
- Never take a payment (no payment phase exists).
- Never expose a service-role key or SMS secret to the client (`NEXT_PUBLIC`).
- Never enable the dev fake-OTP path.
- Never hold real/production customer data.
