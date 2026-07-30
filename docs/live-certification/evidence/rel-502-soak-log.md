# REL-502 seven-day soak log

Candidate: ____________________

Pilot organisation (redacted reference): ____________________

Soak start (UTC): ____________________

Current status: **NOT STARTED — entry criteria are blocked.**

## Entry audit — 30 July 2026

| Entry criterion | Observation | Result |
|---|---|---|
| Tasks 1–9 complete or product-waived | GGL-501/502/503 live work, OBS staging drills, A11Y manual sign-off, OPS staging/live rehearsals, and CI URLs remain blocked | BLOCKED |
| CI green on `main` | No Git remote or Actions run exists | BLOCKED |
| Staging alerts quiet for 48 hours | No staging monitoring deployment exists | BLOCKED |
| REL-501 report accepted | Local production-topology report is PASS; human acceptance not recorded | BLOCKED |
| Pilot listing live on staging | Pilot/staging inputs unavailable | BLOCKED |

Entry decision: **NO-GO. Do not start the seven-day clock.**

## Daily procedure

At the same UTC time each day:

1. Record application image, migration ledger, scheduler heartbeat, and all
   fields from `/api/operations/health?scope=platform`.
2. Record alert events and compare the health snapshot with the prior day.
3. Verify `providerTotals.divergence=false` for the pilot.
4. Run the REL-501 reply-consistency query and require zero divergent rows.
5. Account for scheduled synthetic activity: across the week, create one new
   review and perform at least one publish, edit, and delete.
6. Check for duplicate mutations, tenant-isolation anomalies, webhook loss,
   and moderation mishandling.
7. Record operator and pilot-owner acknowledgement.

Any zero-tolerance incident stops the clock. Record the incident, root cause,
fix, regression evidence, and a new day-1 timestamp; do not continue counting
from the interrupted soak.

## Daily entries

| Day | UTC window | Image | Health/heartbeat diff | Synthetic action | Divergence/consistency | Alerts | Zero-tolerance incident | Operator / pilot owner | Result |
|---:|---|---|---|---|---|---|---|---|---|
| 1 |  |  |  |  |  |  |  |  | NOT RUN |
| 2 |  |  |  |  |  |  |  |  | NOT RUN |
| 3 |  |  |  |  |  |  |  |  | NOT RUN |
| 4 |  |  |  |  |  |  |  |  | NOT RUN |
| 5 |  |  |  |  |  |  |  |  | NOT RUN |
| 6 |  |  |  |  |  |  |  |  | NOT RUN |
| 7 |  |  |  |  |  |  |  |  | NOT RUN |

## Incident/restart log

| Timestamp UTC | Incident | Root cause | Fix and regression evidence | New day 1 | Owner |
|---|---|---|---|---|---|
| None | — | — | — | — | — |

## Exit

- Seven uninterrupted days complete: [ ]
- Daily provider divergence checks all zero: [ ]
- Daily reply-consistency checks all zero: [ ]
- Zero unresolved zero-tolerance incidents: [ ]
- Product, engineering, QA, security, operations, and pilot-owner checklist
  signatures complete: [ ]

Production decision: **BLOCKED — soak not started and release checklist
unsigned.**
