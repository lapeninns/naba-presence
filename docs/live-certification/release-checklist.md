# Production release checklist

> The authoritative launch checklist is `docs/release/ledger.md`. This page is
> the candidate-bound sign-off record; every item here must link to evidence
> recorded in the ledger for the same candidate. Topology references were
> updated on 2026-10-09 for Vercel (no container images, no Compose stack, no
> separate scheduler process).

## Latest production promotion — 29 October 2026

- Production: [nabapresence.com](https://nabapresence.com).
- Deployed commit: `c52f9efaacacd449491e72f560284a337f6c3987`, shipping
  PR #262 (the all-flows UX/UI pass: sign-in and legal, onboarding and
  clients, listings, inbox, notifications, calendar and reports, and
  settings, team, billing and the design system), with no server, contract
  or migration change.
- Vercel deployment: `dpl_B9Q2RCcQcXkNizvhJAxrfDj19axD`.
- Promoted at `2026-10-29T11:04:07Z` (11:04 Europe/London).
- [Production receipt](../release/receipts/20261029T110407Z-c52f9efaacac.json)
  and its byte-pinned [local gate receipt](../release/receipts/20261029T110407Z-c52f9efaacac.local.json).
- All 17 exact-main local release gate steps passed with no requested skips,
  in 15.2 minutes: 9,128 unit/component tests (one existing opt-in live AI
  case skipped), 1,568 integration tests with no skips and 603 browser cases.
  Formatting, design/contrast, bundle budgets, migration checks, production
  dependency audit, workflow lint and full-history secret scanning passed.
  Upgrade base: `7a70387b365412c33ffe7c6fbca28d27059f103b`.
- `db:status --expect-current` against production confirmed all 149
  migrations applied, with no pending or unknown versions. The commit ships
  no new migration, so none was applied and no snapshot was taken.
- The source-owned helper staged with `--skip-domain`; its authenticated
  staged readiness probe reported this exact SHA before `vercel promote`. The
  production receipt's first probe confirmed it and `productionProbe.ok` is
  true. Follow-up protected readiness and platform health returned HTTP 200,
  `release.sha` equal to the receipt's with source `naba_release_sha`, and
  `schema.compatible: true`; `vercel promote status` names this deployment.
  Readiness remains **degraded** solely for existing `telemetry_disabled`
  (`no_endpoint`); this is not a fully healthy telemetry claim.
- Public check: `/` redirects (HTTP 307) and `/sign-in` and `/terms` answer
  HTTP 200. The public e2e supplement and an authenticated browser smoke were
  not run for this promotion. No business publishing, password reset, email,
  edit or provider-sync action was triggered.

## Historical PR #66 certification record

Release candidate: PR #66 integration release (`329490066df2`)

Git SHA (receipt `sha`): `329490066df2b49ed2f2bdeadd902b073e8808b1`

Vercel deployment ID (receipt `deploymentId`): `dpl_4buEsP8zUxBHzyR2VNXnZMKQXLzN`

Release receipt (`docs/release/receipts/…json`, written by
`pnpm release:promote`): `docs/release/receipts/20261013T004903Z-329490066df2.json`

Decision date: ____________________

Current decision: **NO-GO — entry criteria, soak, and signatures are
incomplete.**

No blank item is implicitly accepted. A waiver requires the product owner,
owner, due date, rationale, and compensating control in the exception table.

## Entry and automated gates

- [ ] Sprint 1–4 release gates complete in CI on `main`.
- [ ] `pnpm typecheck` green in CI; run URL: ____________________
- [ ] `pnpm lint` green in CI; run URL: ____________________
- [ ] `pnpm test` green in CI; run URL: ____________________
- [ ] `pnpm db:migrate` and `pnpm db:runtime-role` green against PostgreSQL 17
      in CI; run URL: ____________________
- [ ] `pnpm build` green in CI; run URL: ____________________
- [ ] `pnpm test:integration` green with a non-superuser `DATABASE_URL`; run
      URL: ____________________
- [ ] `pnpm test:e2e` green; run URL: ____________________
- [ ] REL-501 load report accepted by engineering and operations.
- [ ] No unresolved P0/P1 defect.

## Staging and live certification

- [ ] Staging uses a non-superuser member of `naba_app_runtime`.
- [ ] `assertProductionSafety()` passes at staging boot.
- [ ] Hosted Supabase Auth email confirmations, confirmation/recovery
      templates, redirect allow list, custom SMTP, and rate limits are verified.
- [ ] Registration, confirmation, recovery, invitation acceptance, and a
      second-device login preserve the same organisation Google connection.
- [ ] Staging Pub/Sub topic, push subscription, DLQ, OIDC audience, and pinned
      service account are verified.
- [ ] GGL-501 ingestion lifecycle evidence is complete and the real redacted
      Pub/Sub fixture is committed.
- [ ] GGL-502 publish/moderation/edit/delete/republish and ambiguity evidence
      is complete.
- [ ] GGL-503 notification mask, payload casing, media, VoM, refresh,
      invalid-grant, and quota evidence is complete or explicitly accepted.
- [ ] OBS-501 staging alerts fired during controlled injections and returned to
      quiet.
- [ ] A11Y-501 manual keyboard and VoiceOver plus NVDA/JAWS sign-off is
      recorded.
- [ ] OPS-501 staging migration/rollback and live disconnect/purge/reconnect
      rehearsals passed.

## Connection persistence (connect once, return daily)

See `docs/specs/2026-09-23-connect-once-implementation.md`.

- [ ] Migrations 0047–0052 applied to production through the session pooler;
      `pnpm db:status` shows every file applied.
- [ ] Google OAuth app publishing status is **In production** (not Testing);
      screenshot of the Audience page attached: ____________________
- [ ] Data Access page checked for the `business.manage` scope class; OAuth
      verification started or not required: ____________________
- [ ] Business Profile API quota confirmed non-zero (checked 2026-09-23: 300
      QPM on Business Information, Account Management and Performance).
- [ ] Email provider configured (`EMAIL_PROVIDER`, `EMAIL_API_KEY`,
      `EMAIL_FROM`, `OPS_ALERT_EMAILS`) and one test incident delivered in
      staging: ____________________
- [ ] RISC stream registered and `stream:verify` recorded as a `risc_event`
      with outcome `verification`: ____________________
- [ ] Vercel plan confirmed to run the minute and 15-minute crons.
- [ ] Revocation drill: access removed at myaccount.google.com reaches Needs
      reconnect, email and banner within 15 minutes (1 minute with RISC).
- [ ] Disconnect drill: the old refresh token answers `invalid_grant` at the
      token endpoint.
- [ ] 30-day persistent-connection soak on staging passed (procedure in the
      implementation record, §5); evidence: ____________________

## Seven-day soak and canary

- [ ] Staging alerts were quiet for 48 hours before soak day 1.
- [ ] Seven consecutive completed soak days are recorded in
      `evidence/rel-502-soak-log.md`.
- [ ] No unresolved duplicate mutation, provider divergence, tenant-isolation
      anomaly, webhook loss, or moderation mishandling occurred.
- [ ] Daily synthetic review/publish/edit/delete activity is accounted for.
- [ ] First production tenant is the pilot organisation only.
- [ ] Pilot-only canary lasts one week before staged tenant onboarding.
- [ ] Pilot owner has an incident contact and can request an immediate pause.

## Rollback authorization

- [ ] Feature-flag order rehearsed: set `PUBLISH_ENABLED=false`, then
      `DRAFTS_ENABLED=false`; pause `SYNC_ENABLED`/`WEBHOOKS_ENABLED` only when
      ingestion itself is unsafe.
- [ ] Pre-deploy database snapshot restore tested.
- [ ] Previous Vercel production deployment retained and promote/Instant
      Rollback tested.
- [ ] Snapshot plus previous Vercel deployment is treated as one rollback
      unit.
- [ ] On-call has the exact rollback commands, access, and decision authority.
- [ ] All eight Vercel Cron entries are active with the expected schedules
      after rollback (Instant Rollback does not change the cron configuration),
      and the jobs runner, health scraper, and alert routing are verified.

## Program release definition

- [ ] Sprint 1–3 P0/P1 safety gates and Sprint 4 release-scope behavior are
      complete.
- [ ] All required CI gates are green on the non-superuser runtime role.
- [ ] Non-superuser staging boot safety is demonstrated.
- [ ] All live-Google lifecycle and failure-recovery evidence is committed.
- [ ] Seven-day pilot soak has no unresolved zero-tolerance incident.
- [ ] Every remaining P2 item is accepted with an owner and date.
- [ ] All six signatories below approve this exact release candidate.

## Exceptions and accepted P2 work

| Item          | Severity | Rationale and compensating control | Owner | Due date | Product approval |
| ------------- | -------- | ---------------------------------- | ----- | -------- | ---------------- |
| None accepted | —        | —                                  | —     | —        | —                |

## Sign-off

Typing a name is not enough: each signer records the date, release candidate,
and decision after reviewing the linked evidence.

| Role        | Name | Date | Candidate | Decision | Signature/evidence reference |
| ----------- | ---- | ---- | --------- | -------- | ---------------------------- |
| Product     |      |      |           |          |                              |
| Engineering |      |      |           |          |                              |
| QA          |      |      |           |          |                              |
| Security    |      |      |           |          |                              |
| Operations  |      |      |           |          |                              |
| Pilot owner |      |      |           |          |                              |

Release is forbidden until every required checkbox is checked, every exception
is explicitly accepted, and all six decisions are **GO**.
