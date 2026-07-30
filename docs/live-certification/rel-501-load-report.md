# REL-501 load and failure report

Date: 30 July 2026

Environment: local production-topology Compose stack (`nabapresence-rel501`)

Application: `http://127.0.0.1:3200`

PostgreSQL: 17 at `127.0.0.1:54329`, application role `naba_app`

Google API: deterministic local stub through `GOOGLE_API_PROXY_BASE`

Telemetry: OTLP HTTP to the Compose collector; Prometheus at
`http://127.0.0.1:9464/metrics`

## Commands

```sh
node scripts/load/webhook-storm.mjs \
  --base-url http://127.0.0.1:3200 \
  --duration 300 --rate 50 --retry-window 120 --routes 4 \
  --stub-port 3211 \
  --ambiguous-put-delay 120 --ambiguous-put-seconds 60

node scripts/load/backfill-scale.mjs \
  --base-url http://127.0.0.1:3200 \
  --duration 300 --locations 100 --reviews-per-location 500 \
  --scheduler-organisations 100 --stub-port 3211

node scripts/load/inbox-concurrency.mjs \
  --base-url http://127.0.0.1:3200 \
  --duration 300 --concurrency 50 --reviews 100000 \
  --pool-max 3 --metrics-url http://127.0.0.1:9464/metrics
```

The webhook workload uses four independently routed Google connections because
the production limiter intentionally caps each connection at 25 requests per
second. The captured notification envelope and field casing are unchanged;
only message ID, review name, and the seeded route are varied.

## Results

### Webhook storm and failure injection

```json
{"sent":18755,"ok":15000,"failed":3755,"p50Ms":13.28,"p95Ms":2040.85,"p99Ms":3270.09}
```

- Logical messages: 15,000
- Event rows: 15,000
- Processed: 15,000
- Failed after recovery: 0
- Dead: 0
- Lost: 0
- Inbox samples during storm: 255; p95 8.8 ms; maximum 41.25 ms
- Maximum in-flight deliveries: 200

The web service was stopped for exactly 30 seconds after traffic began, then
started through Compose. The 3,755 failed delivery attempts are expected nacks
from that outage. The script resent them with their original message IDs; every
logical message eventually returned 2xx and mapped to one processed event row.

The Google stub returned HTTP 500 for reply PUTs for 60 seconds. Results:

```json
{"requested":12,"ambiguousResponses":12,"attempts":12,"terminalAttempts":12,"divergent":0}
```

The jobs runner recovered all attempts to `succeeded|failed`. The consistency
query found no case where a succeeded attempt disagreed with reply publication
state, or where a failed attempt was marked published.

### Backfill and scheduler scale

```json
{"sent":4,"ok":4,"failed":0,"p50Ms":4956.13,"p95Ms":22052.06,"p99Ms":22052.06}
```

- Locations: 100
- Stub reviews per location: 500
- Expected and stored reviews: 50,000
- End-to-end backfill duration: 43,967.83 ms
- Duplicate `google_review_name_hash` groups: 0
- Incomplete backfill checkpoints: 0
- Organisations presented to reconcile: 100
- Organisations processed: 101 (100 fixtures plus the local bootstrap org)
- Reconcile pages: 2
- Reconcile execution duration: 4,968.39 ms
- Scheduler budget: 45,000 ms

The script waits when the live scheduler owns the reconcile advisory lock and
times only non-skipped reconcile work.

### Inbox concurrency and pool exhaustion

The web service was recreated with `DATABASE_POOL_MAX=3`; the collector was
reset immediately before the run.

```json
{"sent":111805,"ok":111805,"failed":0,"p50Ms":128.86,"p95Ms":150.06,"p99Ms":189.06}
```

- Concurrent authenticated sessions: 50
- Tenant review rows: 100,000
- HTTP 5xx responses: 0
- Response p95: 150.06 ms
- `nabapresence.tenant_transaction.duration` p95: 100 ms
- Maximum active `naba_app` client backends: 3
- Maximum PostgreSQL parallel workers: 0

The pool metric counts PostgreSQL `client backend` rows for `naba_app`
separately from database parallel workers and the admin sampler.

## Acceptance decision

| Criterion | Threshold | Observation | Result |
|---|---:|---:|---|
| Webhook logical messages preserved | zero lost | 15,000/15,000 | PASS |
| Webhook terminal event state | no residual failed/dead | 0/0 | PASS |
| Inbox during webhook storm | p95 < 2 s | 8.8 ms | PASS |
| Backfill uniqueness | zero duplicates | 0 | PASS |
| Backfill checkpoints | all succeeded | 0 incomplete | PASS |
| Scheduler scale | 100 orgs within 45 s | 101 in 4.97 s | PASS |
| Inbox concurrency | p95 < 1.5 s | 150.06 ms | PASS |
| Inbox availability | zero 5xx | 0 | PASS |
| Tenant transaction duration | p95 < 500 ms | 100 ms | PASS |
| Pool exhaustion probe | no clients above max 3 | maximum 3 | PASS |
| Ambiguous publish recovery | all terminal, zero divergence | 12/12, 0 | PASS |

REL-501 result: **PASS**.

## Fix-forwards produced by the drills

1. The failure-injection loop now treats transport closes as retryable and
   bounds in-flight delivery work. This prevents a post-outage retry herd from
   exhausting the Node heap.
2. Compose now includes an OTLP collector and a metric reader so the required
   tenant-transaction histogram is measured rather than inferred.
3. The production runtime role could not use the expression GIN index through
   RLS, causing the initial 100k-row run to miss both latency targets. Migrations
   `0010_inbox_search_document.sql` and `0011_tenant_review_search.sql` add a
   stored search document and a tenant-context-guarded search helper. The
   production-role integration plan now exercises the helper, verifies its GIN
   backing plan, and rejects cross-tenant calls.
4. Scheduler-scale measurement now retries advisory-lock skips and fails unless
   at least 100 organisations are actually processed inside the 45-second
   budget.

The non-certifying red runs and their measured failures were retained in the
execution log; none of their partial results are used as passing evidence.
