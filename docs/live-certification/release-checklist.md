# Production release checklist

Release candidate: ____________________

Application image/digest: ____________________

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
- [ ] Previous application image retained and redeploy tested.
- [ ] Snapshot plus previous image is treated as one rollback unit.
- [ ] On-call has the exact rollback commands, access, and decision authority.
- [ ] Scheduler, jobs runner, health scraper, and alert routing are verified
      after rollback.

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
