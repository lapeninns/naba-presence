# Production release checklist

> The authoritative launch checklist is `docs/release/ledger.md`. This page is
> the candidate-bound sign-off record; every item here must link to evidence
> recorded in the ledger for the same candidate. Topology references were
> updated on 2026-10-09 for Vercel (no container images, no Compose stack, no
> separate scheduler process).

## Latest production promotion — 18 October 2026

- Production: [nabapresence.com](https://nabapresence.com).
- Deployed commit: `38df396f3c826a05b18bd7eec871d25646391933` (PR #243).
- Vercel deployment: `dpl_A8Rn42G33HrqfFqfX2emkYC5Mzho`.
- Promoted at `2026-10-18T17:33:47.577Z` (18:33 Europe/London).
- [Production receipt](../release/receipts/20261018T173347Z-38df396f3c82.json)
  and its byte-pinned [local gate receipt](../release/receipts/20261018T173347Z-38df396f3c82.local.json).
- All 13 required local release gates passed with no requested skips: 8,081
  unit/component tests, 1,412 integration tests with no skips, and 723 browser
  cases with no failures, retries or skips. The default unit lane separately
  skipped 1,412 database cases (executed by integration) and one opt-in live AI
  case. The production dependency audit and full-history secret scan passed.
- Production schema readback confirmed all 149 migrations applied, with no
  pending or unknown versions. No additional migration was applied for this
  promotion; the upgrade base was `5fd05fce8442f330a6ee1b94afcc0acce6113c53`.
- Public platform health at `2026-10-18T17:34:07.172Z` reported this exact SHA
  from `naba_release_sha`, compatible schema, `requiredCount: 149` and
  `missing: []`. Both explicit-SHA and `--expect-promoted` readiness checks
  passed with the existing `telemetry_disabled` degradation (`no_endpoint`);
  the database was reachable and all scheduler ticks were okay.
- Authenticated read-only smoke passed at 17:34–17:35 UTC: sign-in entry using
  the existing session, home/Dashboard landing (currently redirects to Inbox),
  Inbox with 50 loaded reviews, Listings with one loaded listing, and the
  return to Inbox. Fresh password/MFA authentication was not exercised.
- The public e2e supplement passed all four desktop/mobile test-target pairs
  on one bounded repeat of the unchanged pack. Earlier browser-launch and
  connection-timeout attempts are retained in the private QA evidence.
- No business publishing, password reset, email or provider-refresh action
  was triggered by the production smoke checks. PR #243 used an owner-approved,
  one-time admin merge exception for the budget-blocked hosted check; this
  record does not describe hosted Actions as green.

The [previous production receipt](../release/receipts/20261018T083932Z-5fd05fce8442.json)
records the owner-approved private backup and migration 0132–0149 application
for that earlier promotion.

This records the operational promotion. The certification checklist below
continues to describe its historical PR #66 candidate and sign-off scope.

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

| Item | Severity | Rationale and compensating control | Owner | Due date | Product approval |
|---|---|---|---|---|---|
| None accepted | — | — | — | — | — |

## Sign-off

Typing a name is not enough: each signer records the date, release candidate,
and decision after reviewing the linked evidence.

| Role | Name | Date | Candidate | Decision | Signature/evidence reference |
|---|---|---|---|---|---|
| Product |  |  |  |  |  |
| Engineering |  |  |  |  |  |
| QA |  |  |  |  |  |
| Security |  |  |  |  |  |
| Operations |  |  |  |  |  |
| Pilot owner |  |  |  |  |  |

Release is forbidden until every required checkbox is checked, every exception
is explicitly accepted, and all six decisions are **GO**.
