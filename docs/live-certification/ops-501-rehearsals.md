# OPS-501 operational rehearsals

Date: 30 July 2026

Operator: Codex, local development workstation

Release decision: **NO-GO** until the staging-only rehearsals below are run.

This record separates reproducible local evidence from the live/staging evidence
required by the release plan. No local result is presented as a staging result.

## 1. Migration and rollback

Status: **BLOCKED — no staging clone or previously deployed image is available.**

A local production-topology rehearsal was completed against an isolated
PostgreSQL database named `nabapresence_ops501_20260730` in the compose stack:

1. Apply migrations 0001–0003 and seed one organisation, owner, membership,
   and migration ledger.
2. Create a custom-format PostgreSQL snapshot.
3. Apply the remaining committed migrations one at a time.
4. Verify all migration ledger entries, the seeded tenant, and forced RLS on
   `app_user`, `organisation`, and `review`.
5. Drop only the throwaway database, recreate it, and restore the snapshot.
6. Verify the ledger contains only 0001–0003, the seeded tenant survived, and
   `ops_heartbeat` and the generated search document are absent.

Observed forward timings:

| Migration | Wall time |
|---|---:|
| 0004 runtime role | 0.10 s |
| 0005 tenant hardening | 0.09 s |
| 0006 reply lifecycle | 0.10 s |
| 0007 sync reliability | 0.09 s |
| 0008 completeness | 0.09 s |
| 0009 operations heartbeat | 0.09 s |
| 0010 inbox search document | 0.08 s |
| 0011 tenant review search | 0.08 s |
| 202607 remove local demo data | 0.08 s |

Go/no-go point: stop before deploying the new application image if any
migration fails, the ledger is incomplete, tenant counts differ, or forced RLS
is absent. Migrations are roll-forward-only. Application rollback is one
atomic operational unit: restore the pre-deploy snapshot and redeploy the
previous image. The staging requirement remains blocked until this same
procedure is executed with a real staging clone and its previous image.

## 2. Disconnect cleanup

Status: **BLOCKED — no staging pilot connection or Google account is
available.**

Local contract rehearsal:

```text
RUN_DB_TESTS=true \
DIRECT_DATABASE_URL=postgresql://postgres:***@127.0.0.1:54322/postgres \
TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:***@127.0.0.1:54322/postgres \
pnpm test tests/integration/routes/unlink-disconnect.test.ts
```

The route-harness suite passed and proves notification cleanup, token removal,
cleanup scheduling, retention purge/cascade, permission checks, and local
reclaim behavior. It cannot prove that Google removed notification routing or
that the pilot account reconnects. Those observations must be appended here
after the live pilot is available.

## 3. Retention, legal hold, privacy, and CSV

Status: **PASS locally.**

The routed integration rehearsal and CSV contract suite passed:

```text
tests/integration/routes/privacy-fulfilment.test.ts
tests/csv-escaping.test.ts
19 tests across the privacy, disconnect, and CSV rehearsal set — all passed
```

Observed contracts:

- an active legal hold returns `409 privacy_legal_hold` without mutation;
- releasing the hold through `DELETE /api/legal-holds` permits the same
  erasure request to complete and anonymizes the review;
- media is removed and affected counts are audited;
- a 400-day-old audit row is purged while a 100-day-old row remains;
- runtime-role manual audit deletion is rejected by the append-only trigger;
- the routed CSV export prefixes `=SUM(A1)` with an apostrophe, and unit
  contracts cover `=`, `+`, `-`, `@`, tab, and carriage-return prefixes.

## 4. Runbook

Status: **PASS.**

`docs/runbook.md` now documents jobs-runner scheduling and inspection,
dead-letter draining, automatic and manual ambiguity recovery, scheduler
heartbeat response, alert routing, and the snapshot-plus-image rollback unit.
