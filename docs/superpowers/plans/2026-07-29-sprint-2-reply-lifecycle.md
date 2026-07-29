# Sprint 2 — Crash-Safe Reply Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reply creation, publication, moderation, update, deletion, and recovery safe: durable provider-mutation intent before any Google call, Google calls outside DB transactions, ambiguity reconciled by reading before retrying, real moderation-state parsing, mandatory staleness preconditions, a delete lifecycle as robust as publish, legitimate same-body republishing, server-owned audit uniqueness, and explicit approval semantics.

**Architecture:** Publication becomes a three-phase engine in `lib/server/publishing.ts` — `tx1` records intent (`publish_attempt` row `started`), the Google mutation runs **outside any transaction** with a hard timeout, `tx2` reconciles the outcome. Delete uses the same engine with `operation='delete'`. Recovery is uniform: any attempt left in `started`/`ambiguous` is settled by `getGoogleReview` + body comparison before a new mutation is allowed. A Google HTTP stub (reached via a `GOOGLE_API_PROXY_BASE` seam) lets every scenario — crash, timeout, 5xx, moderation states — run as real route tests on the Sprint 1 harness.

**Tech Stack:** Sprint 1 harness (`tests/integration/helpers/*`), postgres.js, Next.js route handlers, node `http` stub server, Vitest.

**Sprint dates / points:** 17–28 August 2026, 57 points. Tickets: REP-201 (13), REP-202 (8), REP-203 (5), REP-204 (5), REP-205 (8), REP-206 (5), AUD-201 (5), APR-201 (8).

## Global Constraints

- Provider calls must not occur inside database transactions (program principle; this sprint is where it lands for mutations — Sprint 3 SYNC-301 does the read paths).
- Names fixed by the master plan §2.1: `publish_attempt.operation` (`'publish' | 'delete'`), `review_reply.publish_generation`, `review_reply.approval_requested_by`, `review_reply.first_published_at` (column added here, backfilled analytics-side in Sprint 4), table `approval_decision`, engine `executePublish` / `executeReplyDelete` in `lib/server/publishing.ts`, seam env `GOOGLE_API_PROXY_BASE`, timeout option `timeoutMs` on `googleRequest`.
- New tables/columns get `grant … to naba_app_runtime` in their migration (Sprint 1 rule, enforced by `tests/migration-contract.test.ts`).
- Migration file for this sprint: `supabase/migrations/0006_reply_lifecycle.sql`.
- Do not commit unless the user explicitly asks.

**Execution order:** Task 1 (harness seams) → Task 2 (REP-201) → Task 3 (REP-202) → Task 4 (REP-203) → Task 5 (REP-204) → Task 6 (REP-205) → Task 7 (REP-206) → Task 8 (AUD-201) → Task 9 (APR-201).

---

### Task 1: Harness seams — Google stub server, connection/review seeding, migration 0006

**Baseline deviation:** Supabase CLI derives its migration version from the
filename prefix and rejected the two pre-Sprint-2 `0004_*` files on a fresh
stack. Renamed only the non-binding local-demo cleanup migration to
`20260729000400_remove_local_demo_data.sql`, updated its internal bookkeeping
version, and added a contract test requiring unique migration prefixes. The
binding `0004_runtime_role.sql`, `0005_tenant_hardening.sql`, and Sprint 2
`0006_reply_lifecycle.sql` names remain unchanged.

Task 1's shared admin cleanup also temporarily disables and restores the
append-only `publish_attempt_event` trigger alongside `audit_log`; reply
lifecycle route tests now create attempt events, so organisation cascades
otherwise fail during teardown. This affects test cleanup only and preserves
the binding `destroyTenants(admin, organisationIds)` signature.

**Files:**
- Create: `tests/integration/helpers/google-stub.ts`
- Create: `tests/integration/helpers/env-defaults.ts`
- Modify: `tests/integration/helpers/tenant.ts` (add `seedGoogleConnection`, `seedLinkedReview`, `saveHumanDraft`)
- Modify: `lib/server/google.ts:305-344` (`GOOGLE_API_PROXY_BASE` rewrite + `timeoutMs`)
- Create: `supabase/migrations/0006_reply_lifecycle.sql`
- Modify: `tests/migration-contract.test.ts`

**Interfaces:**
- Consumes: Sprint 1 `startAppServer(overrides)`, `createTestTenant`, `seedReview`.
- Produces:
  - `startGoogleStub(): Promise<GoogleStub>` where `GoogleStub = { baseUrl: string; calls: Array<{ method: string; path: string; body: unknown }>; respond(matcher: { method: string; pathIncludes: string }, handler: (call) => { status: number; json?: unknown; delayMs?: number }): void; reset(): void; stop(): Promise<void> }`. Default behaviors: `PUT …/reply` → 200 `{ comment: <sent comment>, updateTime: "2026-08-20T10:00:00Z" }`; `DELETE …/reply` → 200 `{}`; `GET …/reviews/{id}` → 200 configurable review JSON.
  - `seedGoogleConnection(admin, { organisationId })` → `{ connectionId, googleAccountName }` — inserts `google_connection` (status `active`, `access_token_ciphertext` = `encryptSecret("stub-access-token")`, `access_token_expires_at = now() + interval '1 hour'`) and `google_account` (`is_active = true`).
  - `seedLinkedReview(admin, { organisationId, connectionId, googleAccountName, text?, rating?, replyState? })` → `{ reviewId, locationId, externalLocationId, googleReviewName }` — `external_location` (verified), `location`, `location_link` (`is_active`), `review` with `external_location_id` set and ciphertext/hash columns built from `googleReviewName`.
  - `saveHumanDraft(baseUrl, cookie, reviewId, body)` → `{ draftId, expectedReviewUpdateTime }` — `POST /api/reviews/{id}/drafts` with `{ tone: "professional", body }` (the human-draft path skips OpenAI; deterministic verification runs, semantic is skipped when `OPENAI_API_KEY` is unset), then `GET /api/reviews/{id}` to read `updateTime` and the draft id.
- These helpers are reused by Sprint 3 (webhook/sync tests) and Sprint 5 (failure-injection): keep signatures stable.

- [x] **Step 1: Env defaults for direct lib imports.** `tests/integration/helpers/env-defaults.ts` (imported first by any test that imports `lib/server/*` directly):

```ts
process.env.NEXTAUTH_SECRET ??= "route-harness-secret-value-32-characters!"
process.env.TOKEN_ENCRYPTION_KEY ??= "route-harness-token-key-32-characters!!"
process.env.CRON_SECRET ??= "route-harness-cron-secret"
process.env.DATABASE_URL ??= process.env.TEST_RUNTIME_DATABASE_URL ?? ""
```

- [x] **Step 2: The proxy seam.** In `lib/server/google.ts`, inside `googleRequest` where the `fetch` is issued (L335-344), rewrite the origin when the seam is set, and add an abort timeout:

```ts
const proxyBase = process.env.GOOGLE_API_PROXY_BASE
const target = proxyBase
  ? new URL(new URL(url).pathname + new URL(url).search, proxyBase).toString()
  : url
const response = await fetch(target, {
  ...init,
  headers,
  cache: "no-store",
  signal:
    options.timeoutMs !== undefined
      ? AbortSignal.timeout(options.timeoutMs)
      : undefined,
})
```

Add `timeoutMs?: number` to `googleRequest`'s options type. Apply the same `GOOGLE_API_PROXY_BASE` rewrite to the two raw token fetches (`exchangeGoogleCode` L190-205, `refreshAccessToken` L243-253) so no test can ever hit the real Google. Behavior is unchanged when the env var is absent; `pnpm test` must stay green.

- [x] **Step 3: Write the stub server.** `tests/integration/helpers/google-stub.ts`:

```ts
import { createServer, type Server } from "node:http"
import { once } from "node:events"

type Call = { method: string; path: string; body: unknown }
type Handler = (call: Call) => { status: number; json?: unknown; delayMs?: number }
type Rule = { method: string; pathIncludes: string; handler: Handler }

export async function startGoogleStub() {
  const calls: Call[] = []
  const rules: Rule[] = []
  const server: Server = createServer(async (request, response) => {
    let raw = ""
    for await (const chunk of request) raw += chunk
    const call: Call = {
      method: request.method ?? "GET",
      path: request.url ?? "/",
      body: raw ? JSON.parse(raw) : undefined,
    }
    calls.push(call)
    const rule = rules.find(
      (candidate) =>
        candidate.method === call.method &&
        call.path.includes(candidate.pathIncludes)
    )
    const result = rule
      ? rule.handler(call)
      : defaultResponse(call)
    if (result.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs))
    }
    response.writeHead(result.status, { "content-type": "application/json" })
    response.end(JSON.stringify(result.json ?? {}))
  })
  server.listen(0, "127.0.0.1")
  await once(server, "listening")
  const { port } = server.address() as { port: number }
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    respond(matcher: { method: string; pathIncludes: string }, handler: Handler) {
      rules.unshift({ ...matcher, handler })
    },
    reset() {
      calls.length = 0
      rules.length = 0
    },
    stop: () =>
      new Promise<void>((resolve) => server.close(() => resolve())),
  }
}

function defaultResponse(call: Call) {
  if (call.method === "PUT" && call.path.endsWith("/reply")) {
    const body = call.body as { comment?: string }
    return {
      status: 200,
      json: { comment: body?.comment ?? "", updateTime: "2026-08-20T10:00:00.000Z" },
    }
  }
  if (call.method === "DELETE" && call.path.endsWith("/reply")) {
    return { status: 200, json: {} }
  }
  if (call.method === "GET" && call.path.includes("/reviews/")) {
    return { status: 200, json: { reviewId: "stub", comment: "" } }
  }
  return { status: 404, json: { error: { status: "NOT_FOUND" } } }
}
```

- [x] **Step 4: Seeding helpers.** Extend `tests/integration/helpers/tenant.ts` with `seedGoogleConnection` / `seedLinkedReview` / `saveHumanDraft` per the Interfaces block. `seedLinkedReview` inserts, in order: `external_location (id, organisation_id, google_connection_id, google_account_name, google_location_name, verified, …)`, `location`, `location_link (organisation_id, external_location_id, location_id, is_active)`, then a `review` exactly like `seedReview` plus `external_location_id` and `google_review_name_hash = sha256(googleReviewName)` with `google_review_name_ciphertext = encryptSecret(googleReviewName)` (import `encryptSecret` from `@/lib/server/crypto` after `./env-defaults`). Use `googleReviewName = \`accounts/stub-account/locations/stub-location/reviews/${reviewId}\``. Column lists must match `supabase/migrations/0001_initial.sql:66-166` — adjust NOT NULL columns there while implementing.

- [x] **Step 5: Migration `0006_reply_lifecycle.sql`**

```sql
begin;

alter table publish_attempt
  add column operation text not null default 'publish'
    check (operation in ('publish', 'delete'));

alter table review_reply
  add column publish_generation integer not null default 0,
  add column approval_requested_by uuid references app_user(id) on delete set null,
  add column first_published_at timestamptz;

alter table organisation
  add column require_two_person_approval boolean not null default false;

create table approval_decision (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references organisation(id) on delete cascade,
  review_id uuid not null references review(id) on delete cascade,
  draft_id uuid references draft(id) on delete set null,
  decided_by uuid references app_user(id) on delete set null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  created_at timestamptz not null default now()
);
alter table approval_decision enable row level security;
alter table approval_decision force row level security;
create policy tenant_isolation on approval_decision using (
  organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
) with check (
  organisation_id = nullif(current_setting('app.organisation_id', true), '')::uuid
);
grant select, insert, update, delete on approval_decision to naba_app_runtime;

insert into schema_migration (version) values ('0006_reply_lifecycle')
on conflict (version) do nothing;

commit;
```

Add migration-contract assertions (0006 contains `operation`, `publish_generation`, `approval_decision`, and the grant).

- [x] **Step 6: Smoke the seams.** New test `tests/integration/routes/reply-harness.test.ts`: boot `startAppServer({ GOOGLE_API_PROXY_BASE: stub.baseUrl })`, seed tenant + connection + linked review, `saveHumanDraft`, then `POST /api/reviews/{id}/publish` `{ draftId, expectedReviewUpdateTime }` with the owner cookie → expect 200 and `stub.calls` to contain one `PUT` ending `/reply`. Run:

```bash
pnpm db:migrate && pnpm build
DIRECT_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres TEST_RUNTIME_DATABASE_URL=postgresql://naba_test_runtime:naba_test_runtime@127.0.0.1:54322/postgres pnpm test:integration
```

Expected: PASS — the current (pre-redesign) publish route works end-to-end against the stub. This is the baseline every later task refactors against.

---

### Task 2: REP-201 — Publication as a durable three-phase state machine

**Files:**
- Modify: `lib/server/publishing.ts` (new engine; keep `googleReplyFromReview`, `googleReplyMatches`, `writePublishAttemptEvent`)
- Modify: `app/api/reviews/[id]/publish/route.ts` (route becomes validation + engine call)
- Modify: `lib/server/google.ts:305-411` (mutation classification fix)
- Create: `tests/integration/routes/publish-lifecycle.test.ts`
- Create: `tests/retry-classification.test.ts`

**Interfaces:**
- Consumes: Task 1 seams; `withTenant`; `connectionAccessToken` (`lib/server/google.ts:278`, signature widened to accept a plain `Sql` — it opens its own short transaction internally when given the pool).
- Produces: `executePublish(input: { organisationId: string; session: Session; reviewId: string; draftId: string; expectedReviewUpdateTime: string; serverRequestId: string }): Promise<PublishOutcome>` where `PublishOutcome = { status: "published" | "rejected" | "pending" | "awaiting_approval" | "failed" | "ambiguous"; googleReplyState: string | null; attemptId: string }`. Sprint 3's retry worker and Task 9's approval route call `executePublish` — the route must stay a thin shell.

- [ ] **Step 1: Mutation classification unit test** — `tests/retry-classification.test.ts`. The current behavior (blind 5×  retry of a 500 on PUT, `google.ts:364-378`) is the bug:

```ts
import { describe, expect, it } from "vitest"

import { classifyMutationFailure } from "@/lib/domain/retry"

describe("mutation failure classification", () => {
  it("treats 5xx responses to mutations as ambiguous, never auto-retried", () => {
    expect(classifyMutationFailure({ kind: "http", status: 500 })).toBe("ambiguous")
    expect(classifyMutationFailure({ kind: "http", status: 502 })).toBe("ambiguous")
    expect(classifyMutationFailure({ kind: "http", status: 408 })).toBe("ambiguous")
  })
  it("treats network/timeout faults as ambiguous", () => {
    expect(classifyMutationFailure({ kind: "network" })).toBe("ambiguous")
    expect(classifyMutationFailure({ kind: "timeout" })).toBe("ambiguous")
  })
  it("treats 429 as retryable (not applied)", () => {
    expect(classifyMutationFailure({ kind: "http", status: 429 })).toBe("retryable")
  })
  it("treats other 4xx as terminal", () => {
    expect(classifyMutationFailure({ kind: "http", status: 400 })).toBe("failed")
    expect(classifyMutationFailure({ kind: "http", status: 404 })).toBe("failed")
  })
})
```

Run `pnpm test tests/retry-classification.test.ts` — FAIL (function absent). Implement in `lib/domain/retry.ts`:

```ts
export type MutationFault =
  | { kind: "http"; status: number }
  | { kind: "network" }
  | { kind: "timeout" }

export function classifyMutationFailure(
  fault: MutationFault
): "ambiguous" | "retryable" | "failed" {
  if (fault.kind !== "http") return "ambiguous"
  if (fault.status === 429) return "retryable"
  if (fault.status === 408 || fault.status >= 500) return "ambiguous"
  return "failed"
}
```

Then change `googleRequest` (`lib/server/google.ts`): when `mode === "mutation"`, set attempts to 1 (no retry loop), map outcomes through `classifyMutationFailure` — HTTP 5xx/408 and transport/`TimeoutError` throw `GoogleMutationAmbiguousError`; 429 throws `ApiError(429, "google_rate_limited", …)`; other 4xx keep today's terminal `ApiError`. Safe-mode reads keep the existing 5-attempt loop. Run the unit test — PASS.

- [ ] **Step 2: Route test for the three-phase shape** — `tests/integration/routes/publish-lifecycle.test.ts`, first cases:

```ts
it("records durable intent before calling Google", async () => {
  // The stub delays 750ms; while the PUT is in flight, the intent row must
  // already be committed and visible to a separate admin connection.
  stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
    status: 200,
    json: { comment: draftBody, updateTime: "2026-08-20T10:00:00.000Z" },
    delayMs: 750,
  }))
  const publishPromise = fetch(`${server.baseUrl}/api/reviews/${reviewId}/publish`, {
    method: "POST",
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ draftId, expectedReviewUpdateTime }),
  })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const [inflight] = await admin`
    select status, operation from publish_attempt
    where organisation_id = ${owner.organisationId} and review_id = ${reviewId}
    order by started_at desc limit 1
  `
  expect(inflight).toEqual({ status: "started", operation: "publish" })
  const response = await publishPromise
  expect(response.status).toBe(200)
  const [settled] = await admin`
    select status from publish_attempt
    where organisation_id = ${owner.organisationId} and review_id = ${reviewId}
    order by started_at desc limit 1
  `
  expect(settled.status).toBe("succeeded")
})

it("holds no open transaction during the Google call", async () => {
  stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
    status: 200, json: { comment: draftBody, updateTime: "2026-08-20T10:00:00.000Z" },
    delayMs: 750,
  }))
  const publishPromise = fetch(/* as above */)
  await new Promise((resolve) => setTimeout(resolve, 300))
  const [{ count }] = await admin`
    select count(*)::int as count from pg_stat_activity
    where state = 'idle in transaction'
      and usename = 'naba_test_runtime'
      and query ilike '%set_config%'
  `
  expect(count).toBe(0)
  await publishPromise
})

it("marks the attempt ambiguous when Google times out", async () => {
  stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({
    status: 200, json: {}, delayMs: 25_000,
  }))
  const response = await fetch(/* publish */)
  expect(response.status).toBe(502)
  expect((await response.json()).error).toBe("google_mutation_ambiguous")
  const [attempt] = await admin`select status from publish_attempt … limit 1`
  expect(attempt.status).toBe("ambiguous")
})

it("marks the attempt ambiguous on a 500 response without retrying", async () => {
  stub.respond({ method: "PUT", pathIncludes: "/reply" }, () => ({ status: 500 }))
  const response = await fetch(/* publish */)
  expect(response.status).toBe(502)
  expect(stub.calls.filter((c) => c.method === "PUT").length).toBe(1)
})

it("short-circuits a retried identical request", async () => {
  const first = await fetch(`${server.baseUrl}/api/reviews/${reviewId}/publish`, {
    method: "POST",
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ draftId, expectedReviewUpdateTime }),
  })
  expect(first.status).toBe(200)
  const putsAfterFirst = stub.calls.filter((c) => c.method === "PUT").length
  const second = await fetch(`${server.baseUrl}/api/reviews/${reviewId}/publish`, {
    method: "POST",
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ draftId, expectedReviewUpdateTime }),
  })
  expect(second.status).toBe(200)
  expect((await second.json()).idempotent).toBe(true)
  expect(stub.calls.filter((c) => c.method === "PUT").length).toBe(putsAfterFirst)
})
```

(Write the elided fetch bodies in full in the test file; each test seeds a fresh tenant/review to stay independent.) Run — Expected: FAIL — today intent+call+outcome share one transaction, so the in-flight queries see nothing and timeouts roll everything back.

- [ ] **Step 3: Implement the engine.** In `lib/server/publishing.ts` add `executePublish`. Structure (all reused validation logic moves verbatim from `app/api/reviews/[id]/publish/route.ts:50-308`):

```
executePublish(input):
  phase1 = withTenant(orgId, sql => {
    load review ⋈ external_location ⋈ draft ⋈ organisation   (route L51-81, unchanged)
    requireLocationAccess / verification gates / staleness gate (L89-123)
    approval fork (L124-174) → return { kind: "awaiting_approval" } (route maps to 202)
    idempotencyKey = sha256(`${orgId}:${reviewId}:${reply.publish_generation}:${bodyHash}`)
    existing-attempt gates (L199-226): succeeded → { kind: "idempotent", reply }
      failed → 409; retryable-not-ready → 429
      started/ambiguous → { kind: "needs_recovery", attemptId }   ← Task 3 consumes
    upsert review_reply → publish_status 'accepted' (L228-249)
    insert/update publish_attempt → status 'started', operation 'publish' (L250-285)
    publish_attempt_event 'started'; review → 'publish_requested'; audit (L286-308)
    read access-token material (connection id + ciphertexts) for phase 2
    return { kind: "proceed", attemptId, googleReviewName, accountName, body }
  })
  if phase1.kind !== "proceed" → return mapped outcome
  // PHASE 2 — no transaction open:
  accessToken = await connectionAccessToken(getDatabase(), …)   // short internal tx
  try:
    provider = await updateGoogleReply(accessToken, googleReviewName, body, { timeoutMs: 20_000 })
  catch (error): fault = classify (GoogleMutationAmbiguousError → "ambiguous", ApiError 429 → "retryable", else "failed")
  // PHASE 3:
  return withTenant(orgId, sql => {
    on success: review_reply → publish_status per moderation state (Task 4),
      first_published_at = coalesce(first_published_at, now()),
      publish_attempt → 'succeeded' + events; review workflow (L466-472); audit
    on fault: publish_attempt → fault status + next_attempt_at = retryable ? retryDelayMs(attempt_no) : null,
      review_reply stays 'accepted', review → 'failed' only for terminal faults (existing L353-401 logic), audit
    return outcome
  })
```

The route (`publish/route.ts`) shrinks to: parse input (`expectedReviewUpdateTime` still optional until Task 5 makes it required), `requireSession`, `PUBLISH_ENABLED` gate, `const outcome = await executePublish(…)`, map `outcome.status` to HTTP exactly as today (200 / 202 / 502-with-`google_mutation_ambiguous` / 409 / 429). `connectionAccessToken`'s signature changes from `(sql: TransactionSql, …)` to `(sql: Sql | TransactionSql, …)`; when handed the pool it wraps its own `begin` for the refresh-persist path — update its two other call sites (`app/api/reviews/[id]/reply/route.ts:62`, `lib/server/reviews.ts:465`) to compile unchanged.

- [ ] **Step 4: Run the suite** — Expected: PASS all Step 2 cases. Also re-run Task 1's smoke test (still green) and `pnpm test` (classification + existing `tests/retry.test.ts` — update its expectations if they assert the old mutation-retry behavior).

- [ ] **Step 5: Crash-recovery scenario (the "Google succeeds and the process fails before local completion" spec case).** Simulate the crash by driving phases directly: insert via admin a `publish_attempt` row `status='started'`, `operation='publish'` with the correct idempotency key for a body already live on the stub (`GET …/reviews/{id}` returns that comment), plus `review_reply` `accepted`. Then `POST /publish` again with the same draft: expect 200, `stub.calls` to contain **one `GET`** (the read-back) and **zero PUTs**, and the attempt settled `succeeded`. This lands fully in Task 3's recovery implementation — write the test now, mark it `.fails` (Vitest `it.fails`) to document the red state, and flip it in Task 3.

---

### Task 3: REP-202 — Read-before-retry recovery for timeouts, connection loss, and ambiguous 5xx

**Files:**
- Modify: `lib/server/publishing.ts` (add `recoverAttempt`)
- Modify: `tests/integration/routes/publish-lifecycle.test.ts` (flip `.fails` cases, add the matrix below)

**Interfaces:**
- Consumes: `getGoogleReview` (`lib/server/google.ts:499`), `googleReplyMatches` (`lib/server/publishing.ts:36-48`).
- Produces: `recoverAttempt(input: { organisationId: string; attemptId: string }): Promise<"succeeded" | "not_applied" | "diverged">` — reads the review from Google **outside any transaction**, compares `reviewReply.comment` to the attempt's intended body (or absence, for deletes), then settles the attempt in a fresh transaction; if the probe `GET` itself times out, it throws `GoogleMutationAmbiguousError` and the attempt stays `ambiguous`. Sprint 3's `JOB-301` worker calls this exact function for stale attempts.

- [ ] **Step 1: Extend the route tests** with the recovery matrix (each case seeds its own tenant):

| Seed state | Google state (stub `GET`) | Expected |
|---|---|---|
| attempt `ambiguous` | reply present, body matches | next publish → 200, attempt `succeeded`, 0 PUTs |
| attempt `ambiguous` | reply absent | next publish → re-sends PUT once, 200 |
| attempt `ambiguous` | reply present, different body | attempt `failed` + `409 reply_diverged` returned (never overwrite silently) |
| attempt `started`, `started_at` 10 min ago (crash) | reply present, matches | 200, `succeeded`, 0 PUTs |
| attempt `started`, fresh (< 2 min — an in-flight request) | — | `409 publish_in_progress`, no Google calls |
| Google `GET` itself times out | — | `502 google_mutation_ambiguous`, attempt stays `ambiguous` |

Write these as explicit tests following Task 2's shape. Run — Expected: FAIL (recovery not implemented; today `started` rows are unreachable states).

- [ ] **Step 2: Implement `recoverAttempt`** in `lib/server/publishing.ts`:

```ts
const IN_FLIGHT_GRACE_MS = 2 * 60 * 1000

export async function recoverAttempt(input: {
  organisationId: string
  attemptId: string
}): Promise<"succeeded" | "still_unknown" | "not_applied" | "diverged"> {
  const context = await withTenant(input.organisationId, async (sql) => {
    const [attempt] = await sql<AttemptRow[]>`
      select pa.id, pa.status, pa.operation, pa.request_body_hash, pa.review_id,
             pa.started_at, r.google_review_name_ciphertext, r.external_location_id,
             el.google_connection_id
      from publish_attempt pa
      join review r on r.id = pa.review_id
      join external_location el on el.id = r.external_location_id
      where pa.id = ${input.attemptId}
      limit 1
    `
    return attempt ?? null
  })
  if (!context || !["started", "ambiguous"].includes(context.status)) {
    return "not_applied"
  }
  if (
    context.status === "started" &&
    Date.now() - new Date(context.started_at).getTime() < IN_FLIGHT_GRACE_MS
  ) {
    throw new ApiError(409, "publish_in_progress", "A publish is in flight.")
  }
  const accessToken = await connectionAccessToken(
    getDatabase(), input.organisationId, context.google_connection_id
  )
  const review = await getGoogleReview(
    accessToken, decryptSecret(context.google_review_name_ciphertext),
    { timeoutMs: 15_000 }
  )
  const applied =
    context.operation === "delete"
      ? !review.reviewReply
      : googleReplyMatches(review, context.intended_body)
  …settle in a fresh withTenant: succeeded / not_applied (attempt → 'retryable',
  next_attempt_at now) / diverged (attempt → 'failed', audit 'review.reply.diverged'),
  each with publish_attempt_event rows ('ambiguity_checked', then the settlement).
}
```

(`intended_body`: store the draft body on the attempt at phase 1 — add `intended_body text` to `publish_attempt` in migration 0006 while it is still this sprint's open migration; the hash alone cannot be compared against Google's returned comment.) Wire it into `executePublish`: the `needs_recovery` branch from Task 2 calls `recoverAttempt` first; `succeeded` → idempotent success; `not_applied` → proceed to a fresh PUT; `diverged` → 409.

- [ ] **Step 3: Run the matrix** — Expected: PASS, including Task 2 Step 5's un-`.fails`-ed crash case.

---

### Task 4: REP-203 — Parse `reviewReplyState` and `policyViolation` correctly

**Files:**
- Create: `tests/fixtures/google/review-reply-states.json`
- Create: `tests/reply-state-parsing.test.ts`
- Modify: `lib/server/reviews.ts:127-134, 235-269` (ingestion)
- Modify: `lib/server/publishing.ts` (publication outcome mapping)
- Create: `lib/domain/reply-state.ts`

**Interfaces:**
- Produces: `parseReplyModeration(review: Record<string, unknown>): { state: "PENDING" | "APPROVED" | "REJECTED" | null; policyViolation: string | null; comment: string | null; updateTime: string | null }` in `lib/domain/reply-state.ts` — the **only** code path that reads moderation fields, used by both ingestion and publication. Sprint 5 GGL-502/503 freezes the fixture file with live captures; if live casing differs, only this module changes.

- [ ] **Step 1: Build the fixture file** `tests/fixtures/google/review-reply-states.json` with five entries (shape per current v4 docs; the audit finding is that moderation arrives as review-level `reviewReplyState`):

```json
{
  "pending": {
    "reviewId": "r1", "starRating": "FOUR", "createTime": "2026-08-01T09:00:00Z",
    "updateTime": "2026-08-02T09:00:00Z",
    "reviewReply": { "comment": "Thanks for visiting.", "updateTime": "2026-08-02T09:00:00Z" },
    "reviewReplyState": "PENDING"
  },
  "approved": { "…": "same shape", "reviewReplyState": "APPROVED" },
  "rejected": {
    "…": "same shape",
    "reviewReplyState": "REJECTED",
    "policyViolation": "OFF_TOPIC"
  },
  "legacyNestedState": {
    "reviewReply": { "comment": "x", "updateTime": "…", "state": "REJECTED", "policyViolation": "SPAM" }
  },
  "noReply": { "reviewId": "r5", "starRating": "FIVE", "updateTime": "2026-08-02T09:00:00Z" }
}
```

- [ ] **Step 2: Unit tests** — `tests/reply-state-parsing.test.ts`: for each fixture assert `parseReplyModeration` returns the right `{state, policyViolation}`; assert unknown state strings (e.g. `"REVIEW_REPLY_STATE_UNSPECIFIED"`, `"SOMETHING_NEW"`) map to `state: null` with the raw value preserved nowhere fatal (they must never reach the CHECK-constrained column). Run — FAIL. Implement `lib/domain/reply-state.ts`:

```ts
const KNOWN_STATES = new Set(["PENDING", "APPROVED", "REJECTED"])

export function parseReplyModeration(review: Record<string, unknown>) {
  const reply =
    typeof review.reviewReply === "object" && review.reviewReply !== null
      ? (review.reviewReply as Record<string, unknown>)
      : null
  const rawState =
    (typeof review.reviewReplyState === "string" && review.reviewReplyState) ||
    (reply && typeof reply.state === "string" && reply.state) ||
    null
  const rawViolation =
    (typeof review.policyViolation === "string" && review.policyViolation) ||
    (reply && reply.policyViolation !== undefined
      ? JSON.stringify(reply.policyViolation)
      : null)
  return {
    state: rawState && KNOWN_STATES.has(rawState) ? (rawState as "PENDING" | "APPROVED" | "REJECTED") : null,
    policyViolation: rawViolation,
    comment: reply && typeof reply.comment === "string" ? reply.comment : null,
    updateTime: reply && typeof reply.updateTime === "string" ? reply.updateTime : null,
  }
}
```

Run — PASS.

- [ ] **Step 3: Rewire ingestion.** In `lib/server/reviews.ts` `upsertGoogleReview`: replace the `providerReply.state` reads (L127-134) and the reply-upsert value derivations (L235-269) with `const moderation = parseReplyModeration(payload)`; `providerWorkflow` becomes `moderation.state === "REJECTED" ? "rejected" : moderation.comment !== null ? "published" : "new"`; the reply upsert writes `moderation.state`, `moderation.policyViolation`, `publish_status` = `rejected`/`published`/`accepted` by the same mapping as today.

- [ ] **Step 4: Rewire publication.** In `executePublish` phase 3, the success path maps the provider response with `parseReplyModeration({ reviewReply: provider, reviewReplyState: (provider as Record<string, unknown>)?.state ?? providerTopLevelState })` — concretely: the PUT response is the reply object; also issue the phase-3 decision from the PUT response alone, defaulting `google_reply_state` to `'PENDING'` **only when the parsed state is null** (today's fallback, now safe because unknown strings can no longer hit the CHECK constraint). `REJECTED` → `publish_status='rejected'`, review workflow `'rejected'`, outcome `"rejected"` (existing L451-489 mapping).

- [ ] **Step 5: Route test with moderation fixtures.** Add to `publish-lifecycle.test.ts`: stub `PUT` returns `{ comment, updateTime, state: "REJECTED", policyViolation: "SPAM" }` → response body `googleReplyState: "REJECTED"`, DB `review_reply.publish_status = 'rejected'`, review `workflow_status = 'rejected'`, and the reply never counts as published (assert `first_published_at is null`). Second case: ingestion — POST a stubbed sync (`seedLinkedReview` + call `POST /api/sync/backfill` with the stub's `GET /reviews` returning the `rejected` fixture) → `review_reply.google_reply_state = 'REJECTED'`. Run — PASS. Run `pnpm test` — PASS.

---

### Task 5: REP-204 — Review version and evidence hash as mandatory publish preconditions

**Files:**
- Modify: `app/api/reviews/[id]/publish/route.ts` (schema: `expectedReviewUpdateTime` required)
- Modify: `lib/server/drafts.ts` (export the evidence builder)
- Modify: `lib/server/publishing.ts` (server-side recheck in phase 1)
- Modify: `tests/integration/routes/publish-lifecycle.test.ts`

**Interfaces:**
- Consumes: the evidence-hash inputs from `app/api/reviews/[id]/drafts/route.ts:87-99` — `{ reviewId, updateTime, reviewText, rating, location, language, tone, businessContext, draftPolicyVersion }`.
- Produces: `buildEvidenceHash(input: EvidenceInput): string` exported from `lib/server/drafts.ts` and used by **both** draft creation and publish phase 1 (single definition; move the existing object construction out of the drafts route into this function so the two cannot drift).

- [ ] **Step 1: Route tests first:**

```ts
it("rejects publish without expectedReviewUpdateTime", async () => {
  const response = await fetch(/* publish with body { draftId } only */)
  expect(response.status).toBe(400)
})

it("rejects publish when the review changed after drafting (version)", async () => {
  const draft = await saveHumanDraft(server.baseUrl, owner.cookie, reviewId, body)
  await admin`update review set update_time = now(), review_text = 'edited!'
              where id = ${reviewId}`
  const response = await fetch(/* publish with the stale expectedReviewUpdateTime */)
  expect(response.status).toBe(409)
  expect((await response.json()).error).toBe("review_changed")
})

it("rejects publish when the evidence hash no longer matches (server-side)", async () => {
  const draft = await saveHumanDraft(…)
  const fresh = await fetch(`${server.baseUrl}/api/reviews/${reviewId}`, { headers: { cookie: owner.cookie } })
  const currentUpdateTime = (await fresh.json()).review.updateTime
  await admin`update review set review_text = 'silently different'
              where id = ${reviewId}` // update_time deliberately unchanged
  const response = await fetch(/* publish with the CURRENT expectedReviewUpdateTime */)
  expect(response.status).toBe(409)
  expect((await response.json()).error).toBe("stale_draft_evidence")
})
```

The third case is the one the client-supplied version check can never catch. Run — FAIL (today: first passes silently, third publishes).

- [ ] **Step 2: Implement.** (a) In the publish route schema, change `expectedReviewUpdateTime` from optional to `z.string().min(1)`. (b) In `lib/server/drafts.ts`, extract the evidence-object construction currently inlined in `drafts/route.ts:87-99` into `export function buildEvidenceHash(input: {reviewId: string; updateTime: string; reviewText: string | null; rating: number; location: string; language: string; tone: string; businessContext: string | null; draftPolicyVersion: string}): string` (`sha256(JSON.stringify(…))`, identical key order — move, don't duplicate), and update the drafts route to call it. (c) In `executePublish` phase 1, after loading review+draft+org, recompute with the **current** review values and the draft's stored parameters (`draft.tone`, `draft.language`, org business context — extend the phase-1 select with the columns the builder needs) and compare to `draft.evidence_hash`; mismatch → `ApiError(409, "stale_draft_evidence", "The review changed since this draft was verified. Re-verify the draft.")`. Keep the existing `expectedReviewUpdateTime` comparison (`publish/route.ts:114-123` logic) as `409 review_changed`.

- [ ] **Step 3: Update the client.** `lib/naba-presence-api.ts:271` `publishDraft` already always sends `expectedReviewUpdateTime` (`reviews-view.tsx:973`) — no UI change; verify by grep and by running `pnpm test:a11y` (the mocked inbox spec includes a publish flow).

- [ ] **Step 4: Run** the suite + full gates. Expected: PASS.

---

### Task 6: REP-205 — Reply deletion from every reachable workflow state, without divergence

**Files:**
- Modify: `app/api/reviews/[id]/reply/route.ts` (thin shell over the engine)
- Modify: `lib/server/publishing.ts` (add `executeReplyDelete`)
- Modify: `lib/domain/workflow.ts` (+ its mirror trigger via migration 0006 addendum — see Step 3)
- Create: `tests/integration/routes/delete-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 2/3 engine internals (`recoverAttempt`, phase helpers).
- Produces: `executeReplyDelete(input: { organisationId: string; session: Session; reviewId: string; serverRequestId: string }): Promise<{ status: "deleted" | "cancelled" | "ambiguous"; attemptId: string | null }>`. Sprint 4 UI-401's delete button calls the route; Sprint 3's worker recovers its ambiguous attempts exactly like publish ones (same table, `operation='delete'`).

- [ ] **Step 1: Enumerate reachable states and write the matrix test.** Reachable `(review.workflow_status, review_reply.publish_status)` pairs with a reply row, from the Sprint-2 codebase: `('published','published')`, `('published','accepted')` (moderation pending), `('rejected','rejected')`, `('awaiting_approval','awaiting_approval')`, `('publish_requested','accepted')` (attempt unsettled), `('failed','accepted')`, plus ingestion-created `('published','published')` with no draft. `tests/integration/routes/delete-lifecycle.test.ts` covers each:

```ts
const cases = [
  { name: "published reply", workflow: "published", publish: "published", expect: 200, google: true },
  { name: "moderation-pending reply", workflow: "published", publish: "accepted", expect: 200, google: true },
  { name: "rejected reply", workflow: "rejected", publish: "rejected", expect: 200, google: true },
  { name: "awaiting approval (never sent)", workflow: "awaiting_approval", publish: "awaiting_approval", expect: 200, google: false },
  { name: "unsettled publish attempt", workflow: "publish_requested", publish: "accepted", expect: 409, google: false },
]
```

For each: seed the pair via admin (plus a settled/unsettled `publish_attempt` as appropriate), `DELETE /api/reviews/{id}/reply` with an owner cookie, assert status; when `google: true` assert exactly one stub `DELETE` call and final DB `publish_status='deleted'`, `workflow_status` per Step 3's table, `publish_generation` incremented; when `google: false` assert **zero** Google calls (local cancel → `publish_status='not_published'`, workflow `'drafted'`); the 409 case asserts `publish_in_progress` (delete refuses while an attempt is `started`/`ambiguous` until recovery settles it). Add divergence cases: stub `DELETE` returns 404 → treated as success (already gone — idempotent); stub `DELETE` times out → 502 `google_mutation_ambiguous`, attempt row `operation='delete'` status `ambiguous`, and a follow-up `DELETE` after stub `GET` shows no reply → 200 via recovery with no second Google `DELETE`. Run — Expected: FAIL comprehensively (today: no ledger, no idempotency, `workflow_status='new'` unconditionally, transitions rejected by the trigger, ambiguity rolls back silently).

- [ ] **Step 2: Implement `executeReplyDelete`** in `lib/server/publishing.ts`, same three-phase shape:

- Phase 1 (`withTenant`): load review ⋈ reply ⋈ external_location; `requireLocationAccess` + `canPublishLocation` (as `reply/route.ts:54-61` today); if no reply row or `publish_status in ('deleted','not_published')` → `ApiError(404, "reply_not_found", …)`. If an attempt for this review is `started`/`ambiguous` → run recovery first (Task 3), else 409. **Local-cancel branch:** `publish_status in ('awaiting_approval')` or (`'accepted'` with no `succeeded` publish attempt and `google_reply_updated_at is null`) → update reply to `'not_published'`, workflow → `'drafted'`, audit `review.reply.cancelled`, return `{status:"cancelled"}` — no Google call, no attempt row. **Remote branch:** insert `publish_attempt` `operation='delete'`, `status='started'`, `idempotency_key = sha256(\`${orgId}:${reviewId}:delete:${publish_generation}\`)`, `intended_body = null`; audit `review.reply.delete_requested`; return connection material.
- Phase 2: `deleteGoogleReply(accessToken, reviewName, { timeoutMs: 20_000 })`; catch: HTTP 404 → treat as applied; ambiguous/timeout → fault.
- Phase 3 (`withTenant`): applied → reply `publish_status='deleted'`, `google_reply_state=null`, `google_policy_violation=null`, `publish_generation = publish_generation + 1`, `google_reply_updated_at = now()`; workflow per table below; attempt `succeeded`; audit `review.reply.deleted`. Fault → attempt `ambiguous`/`failed` (+ `next_attempt_at` for retryable), audit `review.reply.delete_failed`, rethrow mapped error.

- [ ] **Step 3: Workflow transitions.** Extend `ALLOWED_TRANSITIONS` in `lib/domain/workflow.ts` and the SQL trigger identically (append to `supabase/migrations/0006_reply_lifecycle.sql` — it is still this sprint's open migration — a `create or replace function enforce_review_workflow_transition()` with the full updated body):

| From | Added target | Used by |
|---|---|---|
| `rejected` | `new` (already allowed) | delete of rejected reply |
| `published` | `new` (already allowed) | delete of published reply |
| `awaiting_approval` | `drafted` (already allowed) | local cancel |
| `failed` | `new` (already allowed) | delete after failed publish |

Verification here is that **no new transitions are actually needed** once delete stops writing `'new'` unconditionally — the engine picks the target per branch: remote delete → `'new'`; local cancel → `'drafted'`. Update `tests/workflow.test.ts` to assert the engine's two mappings (`deleteWorkflowTarget(branch)` helper exported from `lib/domain/workflow.ts`).

- [ ] **Step 4: Route shell.** `app/api/reviews/[id]/reply/route.ts` DELETE becomes: session + `PUBLISH_ENABLED` gate + `executeReplyDelete` + map `{deleted→200, cancelled→200, ambiguous→502}`.

- [ ] **Step 5: Run the matrix** — Expected: PASS. Re-run the publish suite (recovery is shared — no regressions), then full gates.

---

### Task 7: REP-206 — Legitimate same-body republishing after deletion

**Files:**
- Modify: `tests/integration/routes/publish-lifecycle.test.ts`

**Interfaces:**
- Consumes: Task 2's generation-scoped idempotency key + Task 6's generation increment. This task is proof, not new mechanism.

- [ ] **Step 1: Write the spec scenario as a route test:**

```ts
it("permits republishing identical text after a delete", async () => {
  const body = "Thank you for the kind words about our breakfast."
  const draft1 = await saveHumanDraft(server.baseUrl, owner.cookie, reviewId, body)
  expect((await publish(draft1)).status).toBe(200)
  expect((await deleteReply()).status).toBe(200)
  const detail = await fetch(`${server.baseUrl}/api/reviews/${reviewId}`, { headers: { cookie: owner.cookie } })
  const freshUpdateTime = (await detail.json()).review.updateTime
  const draft2 = await saveHumanDraft(server.baseUrl, owner.cookie, reviewId, body)
  const republish = await publish(draft2, freshUpdateTime)
  expect(republish.status).toBe(200)
  expect(stub.calls.filter((c) => c.method === "PUT").length).toBe(2)
  const attempts = await admin`
    select idempotency_key, operation, status from publish_attempt
    where review_id = ${reviewId} order by started_at
  `
  expect(attempts).toHaveLength(3) // publish, delete, publish
  expect(attempts[0].idempotency_key).not.toBe(attempts[2].idempotency_key)
})
```

- [ ] **Step 2: Run.** Expected: PASS directly if Tasks 2/6 are correct (generation 0 → key A; delete increments to 1 → republish key B). If it fails with `previous_publish_failed` or an idempotent short-circuit, the generation is not in the key — fix `executePublish`'s key derivation, not the test.

- [ ] **Step 3: Guard the old behavior too:** same-generation identical retry still short-circuits idempotently (one PUT total) — already covered in Task 2; re-run to confirm.

---

### Task 8: AUD-201 — Server-generated audit uniqueness; client-suppression closed

**Files:**
- Modify: `lib/server/http.ts` (new `serverRequestId`)
- Modify: `app/api/reviews/[id]/publish/route.ts`, `app/api/reviews/[id]/reply/route.ts`, `app/api/reviews/[id]/drafts/route.ts`, `app/api/drafts/[id]/verify/route.ts`, `app/api/google/connect/callback/route.ts`, `app/api/members/route.ts` (call-site sweep — full list via grep in Step 3)
- Create: `tests/integration/routes/audit-integrity.test.ts`

**Interfaces:**
- Produces: `serverRequestId(request: Request): { id: string; clientId: string | null }` — `id` is always `crypto.randomUUID()`, `clientId` is the `x-request-id` header if present (recorded in audit `metadata.clientRequestId`, used for trace correlation only). `writeAudit` keeps its signature; callers pass `requestId: serverId.id` and spread `clientRequestId` into metadata. The existing `requestId()` export is deleted (compile errors locate every call site).

- [ ] **Step 1: Failing route test** — `tests/integration/routes/audit-integrity.test.ts`:

```ts
it("audits every attempt even when the client pins x-request-id", async () => {
  const pinned = "same-id-every-time"
  const body1 = "First reply body."
  const draft1 = await saveHumanDraft(server.baseUrl, owner.cookie, reviewId, body1)
  await publish(draft1, { "x-request-id": pinned })
  await deleteReply({ "x-request-id": pinned })
  const draft2 = await saveHumanDraft(server.baseUrl, owner.cookie, reviewId, body1)
  await publish(draft2, { "x-request-id": pinned })
  const rows = await admin`
    select action, count(*)::int as count from audit_log
    where organisation_id = ${owner.organisationId}
      and action in ('review.reply.publish_requested', 'review.reply.published')
    group by action
  `
  const byAction = Object.fromEntries(rows.map((r) => [r.action, r.count]))
  expect(byAction["review.reply.publish_requested"]).toBe(2)
  expect(byAction["review.reply.published"]).toBe(2)
})

it("correlates one request's audit events under one server id", async () => {
  const draft = await saveHumanDraft(…)
  await publish(draft)
  const rows = await admin`
    select distinct request_id from audit_log
    where organisation_id = ${owner.organisationId}
      and action like 'review.reply.%'
  `
  expect(rows).toHaveLength(1)
})
```

Run — Expected: FAIL — today the pinned header makes the second publish's rows vanish via `on conflict do nothing`, and unpinned requests get four different UUIDs per publish.

- [ ] **Step 2: Implement.** In `lib/server/http.ts` replace `requestId` with:

```ts
export function serverRequestId(request: Request): {
  id: string
  clientId: string | null
} {
  const clientId = request.headers.get("x-request-id")
  const id = crypto.randomUUID()
  trace.getActiveSpan()?.setAttribute("nabapresence.request_id", id)
  if (clientId) {
    trace.getActiveSpan()?.setAttribute("nabapresence.client_request_id", clientId)
  }
  return { id, clientId }
}
```

- [ ] **Step 3: Sweep the call sites.** `grep -rn "requestId(request)" app lib` — in each handler compute `const rid = serverRequestId(request)` **once** at the top and pass `rid.id` (with `:connection`/`:signin`-style suffixes preserved where the callback route uses them) to every `writeAudit`; add `clientRequestId: rid.clientId` into each audit `metadata`. The engine functions (`executePublish`, `executeReplyDelete`) already take `serverRequestId: string` — thread `rid.id` through.

- [ ] **Step 4: Run** Step 1's tests + the full integration suite (publish/delete suites assert audit rows too — update any that assumed the old per-event UUIDs). Expected: PASS.

---

### Task 9: APR-201 — Explicit approval semantics with optional two-person rule

**Files:**
- Create: `app/api/reviews/[id]/approval/route.ts`
- Modify: `lib/server/publishing.ts` (record `approval_requested_by`; expose `executePublish` for the approval route)
- Modify: `app/api/settings/route.ts` (expose `requireTwoPersonApproval`)
- Modify: `lib/naba-presence-api.ts` (add `approveReply`, `rejectReply`; extend settings types)
- Modify: `components/naba-presence/reviews-view.tsx:1246-1259` (Approve/Reject actions for `awaiting_approval`)
- Modify: `components/naba-presence/settings-view.tsx` (two-person toggle beside the existing approval switch)
- Create: `tests/integration/routes/approval.test.ts`

**Interfaces:**
- Consumes: `executePublish` (Task 2), migration 0006 columns (`approval_requested_by`, `require_two_person_approval`, `approval_decision`).
- Produces: `POST /api/reviews/{id}/approval` body `{ decision: "approve" | "reject", note?: string }` → 200 `{ status: "published" | "rejected" | … }` for approve (the publish outcome), 200 `{ status: "returned_to_draft" }` for reject. Client: `approveReply(reviewId)`, `rejectReply(reviewId, note?)`.

- [ ] **Step 1: Product rules (write into the route's doc comment — these are the "explicit product rules" the spec demands):**
  1. A publish by a user without publish authority while `organisation.approval_required` routes to `awaiting_approval` and records `approval_requested_by` (existing fork, now attributed).
  2. Approving requires `canPublishLocation` — viewers and unassigned members cannot approve.
  3. If `require_two_person_approval` is on, the approver must differ from `approval_requested_by` (403 `second_approver_required`); this applies **even to owners**.
  4. A user *with* publish authority publishing directly is unaffected unless `require_two_person_approval` is on — in that case their publish also routes to `awaiting_approval` (two-person means two people, always).
  5. Approve executes the standard publish pipeline (all Task 2–5 gates: verification, staleness, evidence, idempotency); `published_by` = approver; an `approval_decision` row records the decision.
  6. Reject returns the review to `drafted`, reply to `not_published`, records the decision + note, audits `review.approval.rejected`.

- [ ] **Step 2: Failing route tests** — `tests/integration/routes/approval.test.ts` covering: member-without-publish POST publish → 202 + `approval_requested_by` set; owner approve → 200 + stub PUT + `approval_decision (decision='approved')` + `published_by = owner.userId`; reject → draft state restored + decision row with note; viewer approve → 403; **two-person on:** requester-with-publish-rights publish → 202 (rule 4), same user approve → 403 `second_approver_required`, second admin approve → 200; cross-tenant approval → 404. Run — FAIL (route absent; rule 4 not implemented).

- [ ] **Step 3: Implement.**
  - Publish fork (`executePublish` phase 1): condition becomes `(!canPublish && record.approval_required) || (record.require_two_person_approval && no prior approval_decision('approved') by another user for this draft)` → on routing to `awaiting_approval`, set `review_reply.approval_requested_by = session.userId`.
  - New route `app/api/reviews/[id]/approval/route.ts`: session; load review+reply+org inside `withTenant`; require `workflow_status = 'awaiting_approval'` else 409; `canPublishLocation` else 403; two-person check per rule 3; insert `approval_decision`; audit `review.approval.approved`/`.rejected`; approve → call `executePublish` with the requester's stored draft (latest verified draft id — same lateral select the publish route uses) and the **current** review `update_time` as `expectedReviewUpdateTime` recomputed server-side (the approver approves what is on screen; the evidence-hash gate from Task 5 still protects content drift); reject → reply `'not_published'`, workflow `'drafted'`.
  - Settings: `PATCH /api/settings` accepts `requireTwoPersonApproval: z.boolean().optional()` (owner-only, same consent pattern as `approvalRequired` at `settings/route.ts:63-76`); `GET` returns it.
  - Client + UI: `approveReply`/`rejectReply` in `lib/naba-presence-api.ts`; in `reviews-view.tsx`, when `review.status === "awaiting_approval"` replace the current relabeled publish button (L1246-1259) with two buttons — **Approve and publish** → `approveReply`, **Reject** → `rejectReply` with a note prompt (reuse the existing dialog idiom); settings toggle beside the approval switch.

- [ ] **Step 4: Run** the approval suite, the publish suite (fork attribution regressions), `pnpm test:a11y` (settings + inbox scenarios re-render), and full gates. Expected: PASS.

---

## Required test scenarios → coverage map (spec §Sprint 2)

| Spec scenario | Test |
|---|---|
| Google succeeds, process fails before local completion | Task 2 Step 5 / Task 3 (`started` + live reply → recovered, 0 extra PUTs) |
| Timeout after an accepted reply | Task 2 timeout case + Task 3 recovery matrix row 1 |
| Retried identical request | Task 2 idempotent short-circuit + Task 7 Step 3 |
| Publish → delete → republish identical text | Task 7 |
| `PENDING`/`APPROVED`/`REJECTED` provider fixtures | Task 4 (unit + ingestion + publication route tests) |
| Stale review content / stale evidence hash | Task 5 (`review_changed`, `stale_draft_evidence`) |
| Delete from every reachable workflow state | Task 6 matrix |
| Publisher / approver / non-publisher / viewer / cross-tenant access | Task 9 suite + Sprint 1 role/IDOR suites extended by each task's 403/404 cases |
| Duplicate audit request IDs supplied by the client | Task 8 |

## Sprint 2 acceptance criteria → evidence map

| Criterion | Evidence |
|---|---|
| Provider mutation intent exists durably before the Google call | Task 2 in-flight `started` assertion |
| A crash cannot produce an untracked successful mutation | Task 2 Step 5 + Task 3 recovery |
| Ambiguous outcomes are reconciled before retrying | Task 3 matrix (read-back before any second PUT/DELETE) |
| Rejected replies are never shown or counted as published | Task 4 (`first_published_at` stays null; workflow `rejected`) |
| Delete never succeeds remotely while rolling back locally into divergence | Task 6 (phase separation + ambiguous ledger row) |
| Approval behavior has explicit product rules and executable tests | Task 9 Step 1 rules + suite |

**Release gate:** No reply mutation can duplicate, silently diverge, or ignore moderation — evidenced by the full `tests/integration/routes/publish-lifecycle.test.ts`, `delete-lifecycle.test.ts`, `approval.test.ts`, and `audit-integrity.test.ts` suites green in CI under the runtime role.
