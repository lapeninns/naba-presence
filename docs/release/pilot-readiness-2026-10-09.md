# NabaPresence domain, SMTP and controlled-pilot readiness

Checked 9 October 2026, approximately 21:36 Europe/London. User-selected scope:
controlled pilot first; no paid signup or commercial pricing implementation.

## Candidate and live configuration

- Checkout: `/Users/amankumarshrestha/LapenInns Project/platform/naba-presence`.
- SMTP verification baseline: `6115040bafaa007b5da008734ce928bee307f095`.
- Pilot implementation branch: `codex/pilot-admission-and-email`. The final
  source SHA and deployment ID are recorded in the external deployment receipt.
- Vercel project: `nabapresence`; deployment
  `dpl_GgBjCJweGaPJKR6HH1oJAPXdA9aL`, READY at the final readback.
- Canonical origin: `https://nabapresence.com`; `www` redirects to it.
- Supabase Auth URLs and Google OAuth origin/callback use the canonical
  domain; customer-facing app/provider branding is NabaPresence.
- Resend domain verified; custom Supabase SMTP enabled with domain-scoped,
  sending-only credentials and sender `NabaPresence <noreply@nabapresence.com>`.
- All 13 Auth subjects and bodies carry NabaPresence. Existing security
  notification activation flags were preserved.
- DKIM, SPF, provider return-path records and monitor-only DMARC published.
- Auth rate limit: 30 emails/hour, 60 seconds per user. This provider limit
  does not replace application admission or rate-limiting controls.

SMTP is active in hosted Auth immediately. The pilot implementation adds
`REGISTRATION_MODE=invite_only` and `TENANT_EMAIL_ENABLED=false` for production.
Registration validates a live invitation and matching address before calling
the auth provider; acceptance checks it again under a row lock. Uninvited
identities cannot create a workspace through login, confirmation or recovery.
Existing members can sign in and recover; missing/stale default-workspace
pointers repair to a remaining membership. Public sign-in hides account
creation unless an invitation is supplied. Invitations enrol members into an
existing organisation, rather than creating a new independent pilot workspace.

Operator mail uses a separate domain-scoped sending credential, sender
`NabaPresence <notifications@nabapresence.com>` and the user-approved operator
inbox. The actual application email adapter sent one authorised test through
live Resend, received in Gmail inbox after one second with SPF/DKIM/DMARC PASS.
This verifies delivery through the adapter; it did not inject an incident into
production or prove every cron failure can page. Tenant incident mail is
suppressed at the send boundary while in-app incidents continue. Provider
configuration requires deployment of these new application flags to activate;
final activation and live invitation receipts are retained outside the repository.

Prior domain work is recorded separately in the domain evidence folder.

## Executed verification

| Check | Result and practical coverage |
| --- | --- |
| Frozen dependency install | Completed against committed lockfile; Next.js 16.3.8 |
| `pnpm verify` | Typecheck and lint pass; 2,673 unit/component tests pass across 261 files; integration cases skip in this unit lane |
| `pnpm build` | Webpack build and standalone preparation pass on Next.js 16.3.8 |
| `pnpm audit --prod --audit-level high --json` | Zero findings at every severity |
| Fresh PostgreSQL preparation | Migrations and restricted runtime-role provisioning pass; owned disposable cluster stopped after checks |
| `pnpm test:integration` | 383 tests pass across 75 files |
| `pnpm test:e2e` | 166 pass, 18 skip; skipped business-mode checks require a business harness, current harness is agency mode; local provider stubs do not establish live Google correctness |
| Signup | Production registration API returns 202 requiring confirmation; real email arrives in Gmail inbox after one second; SPF, DKIM and DMARC PASS |
| Confirmation/sign-in | Received link opens the signed-in inbox; subsequent fresh-browser password sign-in passes |
| Recovery request/mail | Browser form returns expected generic status, API 202; real recovery email arrives in Gmail inbox after one second; SPF, DKIM and DMARC PASS |
| Recovery completion | Received link opens reset form in browser; production API completes reset with 200; new-password browser sign-in passes |
| Recovery invalidation | Old password 401; consumed recovery token 400; pre-reset app session resolves to null |

Agentic browser checks ran with the e2e runner and saved ChatGPT model
connection. Traces/videos were disabled and email-link secrets registered to
avoid credentials in artifacts. An initial confirmation judgment was
inconclusive during review loading; its deterministic inbox URL assertion
passed. A recovery test initially expected the wrong heading and failed before
any password mutation. The corrected recovery run passed, including a settled
inbox judgment. Initial integration execution lacked the standalone build;
that failed receipt was preserved and a fresh correctly prepared full run
passed. These earlier records were not overwritten.

This is focused live authentication evidence plus broad local validation. It
does not certify every role, live Google operation, actual second device,
expired email links, invitation delivery, recovery-form final UI submission,
mobile matrix or production resilience.

## Completed admission decision and remaining release requirements

The overall release decision remains **NO-GO pending applicable gates**.
The completed Auth SMTP setup is ready and operating in production.

1. The user chose **invited testers only** on 9 October. This candidate
   implements that decision. Verify live rejection of uninvited signup,
   invited signup/confirmation and existing-member continuity after deployment.
   Pilot admission counts, rate-limiting residuals and allowed feature scope
   remain separate from the invitation gate.
2. Restore GitHub Actions capacity and require green hosted CI/CodeQL for the
   release candidate. The job annotation says an Actions budget prevented
   execution; this is not a tested code failure. Local results do not replace
   that gate. Candidate CI:
   `https://github.com/lapeninns/naba-presence/actions/runs/37976364366`.
3. Retry Google branding verification after its domain-ownership waiting
   period: evening 10 October 2026 Europe/London, at least 24 hours after the
   recorded ownership verification. Verify the provider's actual outcome;
   ownership verification and NabaPresence branding are not approval of the
   OAuth app. Live Google connection/backfill/write/continuity evidence remains
   required for the advertised pilot capabilities.
4. Operator email is configured with a received test; monitor its actual
   production activation and incident handling after deployment. External
   monitoring, telemetry and response/recovery evidence remain open. The
   platform evaluator does not alert on never-completed ticks or its own
   absence, so a received adapter test cannot close that monitoring gap.
   Receiving a support mailbox is also separate.
5. Reconcile the remaining security, operational and provider ledger rows
   against the selected candidate; run the required restore/rollback/rotation
   and connection/soak evidence. The old dependency and retired-endpoint
   baseline descriptions must not be treated as current findings: PR #59
   upgraded dependencies and PR #60 removed retired endpoints. Those changes
   do not establish unrelated gates as satisfied.
6. Record the applicable product/engineering/QA/security/operations/pilot-owner
   approval. Billing and commercial terms are deferred until paid launch,
   while pilot safety and approval requirements remain in force.

## Read-only production infrastructure snapshot

At 20:34:52 UTC, the hosted database recorded all 61 repository migration
versions, no additional versions, all eight cron completion heartbeats within
their code-defined freshness windows and no open platform incidents. The
`naba_runtime` login and its `naba_app_runtime` group had neither superuser nor
BYPASSRLS; the login carried 30-second statement and 60-second idle transaction
timeouts. The eight sampled application tables had RLS and FORCE RLS enabled
and no SELECT grant to `anon` or `authenticated`. This is a metadata snapshot,
not a restore drill or proof that scheduled work produced correct customer
results. Receipt: `production-database-readback.json` and
`production-readiness-readback-summary.json`.

## Evidence storage

Sanitised receipts, logs and email authentication screenshots:
`/Users/amankumarshrestha/Documents/Codex/2026-10-09/nabapresence-smtp/`.
The test alias and private provider payloads stay outside this repository.
SMTP credentials are held in the operator's macOS credential store and
Supabase's encrypted settings, not in these receipts.

Key files: `supabase-smtp-receipt.json`, `resend-domain-status.json`,
`auth-template-branding.json`, `deployment-receipt-current.json`,
`signup-authentication.txt`, `reset-authentication.txt`,
`recovery-completion.json`, `verify-current.log`, `build-current.log`,
`integration-current.log`, `playwright-current.log`, `pilot-verify-current.log`,
`pilot-build-current.log`, `pilot-integration.log`, `pilot-playwright.log`,
`operator-email-environment.json`, `operator-email-send.json`,
`operator-email-authentication.txt`, `dependency-audit.json`,
`e2e-confirmation/report.json`, `e2e-recovery/report.json` and
`e2e-recovery-current/report.json`.

The passing recovery run ID is
`01a12254-d372-77a6-b2a6-5a3b5decfcad`; the signup/request run ID is
`01a1224e-ace1-740c-b412-b7ea5d05f390`.
