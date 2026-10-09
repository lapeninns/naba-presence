# GBP write migration guide (Sprint 2)

> Historical record of the Sprint 2 migration of the per-module Google
> Business Profile write paths onto `lib/server/gbp-write.ts`. That migration
> is complete: every write surface now runs through `runGbpWrite`. This file is
> retained for provenance and is **not** an active instruction. For the current
> contract read the header of `lib/server/gbp-write.ts` and
> `docs/architecture.md`, "One write pipeline: `runGbpWrite`" and "Ambiguous,
> failed, and interrupted writes".
>
> The three sections below marked **Moved** described behaviour the code still
> has. They now live in `docs/architecture.md`; the text kept here is the
> Sprint 2 wording and may drift. Read the architecture section instead.

Until Sprint 2 the write discipline was hand-copied into `hours.ts`,
`profile.ts`, `media.ts`, `place-actions.ts`, `food-menus.ts`, `posts.ts` and
`publishing.ts`. `lib/server/gbp-write.ts` became the single implementation
those modules migrated onto, without schema changes: each module kept its
attempt table and columns and mapped the canonical status vocabulary onto
whatever its `CHECK` constraint allowed (see `attemptStore`).

## Migration steps (for the 2.2-2.7 module agents; hours.ts as the example)

### 1. Context

Delete the module's private `loadContext` / `contextFor` (`context`,
`postsLocationContext`, ...) and the `google_location_not_linked` throw.
Replace with:

```ts
const linked = await withTenant(session.organisationId, (sql) =>
  loadLinkedLocation(sql, session, locationId, {
    notLinked: {
      message: "Link this location to Google before managing hours.",
    },
  })
)
```

`LinkedLocation` is a superset of every module's old context type
(`locationId`, `locationName`, `timezone`, `externalLocationId`,
`googleConnectionId`, `googleAccountName`, `googleAccountId`,
`googleLocationName`, `canPublish`, `accessToken()`). Modules that used a
different not-linked code (posts: `location_not_linked`) pass
`notLinked: { code }` to keep it; modules with their own 404 wording pass
`notFound: { code?, message? }` (a nonexistent id and a hidden-but-existing id
both raise it). Do not catch-and-rethrow the 404 to reword it.

`linked.accessToken()` replaces `connectionAccessToken(getDatabase(), ...)`.

### 2. Gate

Replace the inline `gbpWritesEnabled` check with:

```ts
requireGbpWrite(getServerEnv(), "profileWrites", {
  status: 409,
  code: "hours_publishing_disabled",
  message: "...",
})
```

and the inline `canPublish` check with
`requirePublishGrant(linked, { code: "publish_permission_required", message: "..." })`.
Codes stay identical.

### 3. Key

Replace the module's `sha256([...].join(":"))` / template-string recipe with:

```ts
idempotencyKey([
  organisationId,
  externalLocationId,
  "hours_publish",
  revision,
  googleHash,
  payloadHash,
])
```

Same inputs, one hashing scheme. Keys derived before migration no longer
match; that is fine because every module's pre-flight snapshot check
(`in_sync` / stale) already covers the exact-repeat case for rows written
before this.

### 4. Store

Declare the module's attempt table once, at module scope:

```ts
const hoursAttempts = attemptStore({
  table: "hours_sync_attempt",
  columns: {
    httpStatus: "provider_http_status",
    responseHash: "provider_response_hash",
    validatedAt: "validated_at",
    startedAt: "started_at",
  },
})
```

Tables whose `CHECK` constraint only knows
`started`/`succeeded`/`failed`/`ambiguous` (media, place actions, posts,
`gbp_management_mutation`) map the in-flight statuses:
`statuses: { validating: "started", validated: "started", publishing: "started" }`.
Tables with `last_error_code` / `google_response` / `provider_response` name
those columns in `columns`. If the generic store cannot express a table (posts
also flips `gbp_local_post.status` on every transition), implement
`AttemptStore` by hand; it is four small functions.

### 5. Pipeline

Replace the hand-written start/validate/publish/readback/settle block with one
`runGbpWrite` call. Before (hours.ts, abridged):

```ts
const attempt = await withTenant(org, async (sql) => {
  const [existing] = await sql`select ... where idempotency_key = ${key}`
  if (existing?.status === "succeeded") return { ...existing, idempotent: true }
  if (existing && ["validating", "validated", "publishing"].includes(existing.status))
    throw new ApiError(409, "hours_publish_in_progress", "...")
  const [row] = existing ? await sql`update hours_sync_attempt set status = 'validating' ...`
                         : await sql`insert into hours_sync_attempt (...) values (...)`
  return { ...row, idempotent: false }
})
if (attempt.idempotent) return { status: "published", attemptId: attempt.id, idempotent: true }
let phase = "validating"
try {
  await patchGoogleLocationHours(token, { validateOnly: true, ... })
  await withTenant(org, (sql) => sql`update ... set status = 'publishing', validated_at = now()`)
  phase = "publishing"
  await patchGoogleLocationHours(token, { validateOnly: false, ... })
} catch (error) {
  const ambiguous = error instanceof GoogleMutationAmbiguousError && phase === "publishing"
  await settleFailure({ status: ambiguous ? "ambiguous" : "failed", code: ... })
  if (!ambiguous) throw error
}
const readBack = normalizeGoogleHours(await getGoogleLocation(...))
if (hashHours(readBack) !== live.canonicalHash) {
  await settleFailure({ status: "failed", code: "google_readback_mismatch" })
  throw new ApiError(502, "google_readback_mismatch", "...")
}
await withTenant(org, async (sql) => {
  await sql`update hours_sync_attempt set status = 'succeeded', ...`
  await reconcileCanonicalResource({ sql, ... })
  await writeAudit(sql, { action: "hours.publish.succeeded", ... })
})
return { status: "published", attemptId: attempt.id, idempotent: false }
```

After:

```ts
const result = await runGbpWrite({
  organisationId: session.organisationId,
  actorUserId: session.userId,
  requestId: input.requestId,
  store: hoursAttempts,
  key,
  intent: {
    location_id: locationId,
    external_location_id: linked.externalLocationId,
    operation: "publish",
    pinned_canonical_revision: live.resource.revision,
    pinned_canonical_hash: live.canonicalHash,
    pinned_google_hash: live.googleHash,
    update_mask: live.patch.updateMask,
    intended_payload: (sql) => jsonColumn(sql, live.patch.payload),
    warnings: (sql) => jsonColumn(sql, live.patch.warnings),
  },
  inProgress: { code: "hours_publish_in_progress", message: "This publish is already in progress." },
  failureCode: "google_hours_publish_failed",
  validate: () => patchGoogleLocationHours(token, { validateOnly: true, ... }, opts),
  mutate: () => patchGoogleLocationHours(token, { validateOnly: false, ... }, opts),
  onAmbiguous: "readback",
  readback: {
    read: async () => normalizeGoogleHours(await getGoogleLocation(token, name, mask, { ...opts, maxAttempts: 3 })),
    verify: ({ readback }) => hashHours(readback) === live.canonicalHash,
    hash: hashHours,
  },
  onSuccess: (sql, ctx) => reconcileCanonicalResource({ sql, ..., googleHash: ctx.readbackHash! }),
  audit: (ctx) => ({
    action: "hours.publish.succeeded",
    subjectType: "hours_sync_attempt",
    subjectId: ctx.attemptId,
    metadata: { locationId, canonicalRevision: live.resource.revision },
  }),
})
return { status: "published", attemptId: result.attemptId, idempotent: result.idempotent }
```

The module keeps everything before the pipeline (live read, stale checks,
overwrite confirmation, `in_sync` short-circuit) and everything after it
(response shaping). Delete `settleFailure` / `failAttempt` / `settle` /
`settleMutation` / `createMutation` / `mutation` / `jsonValue`.

### 6. Behaviour knobs to preserve the module's current semantics

```
onExisting  "resume" (hours, profile, food menus): succeeded -> idempotent,
            in flight -> 409 `inProgress` inside the grace window and
            readback recovery past it (see "In-flight recovery"),
            terminal failure -> re-arm.
            "replay" (media, place actions, posts, management): any
            existing row for the key is returned as idempotent
            (their keys already include the request id).
retry       attemptStore option; "rearm" reuses the failed row (hours,
            profile), "insert" writes a fresh row keyed
            `${key}:${requestId}` (food menus).
onAmbiguous "readback" (hours, food menus) or "fail" (profile, media,
            place actions, posts). See "Ambiguous vs failed" below.
```

Place-action create's list-based recovery of an ambiguous create stays inside
its `mutate` function (catch `GoogleMutationAmbiguousError`, list, find, return
the match or rethrow); the helper then sees either a response or the original
ambiguous error.

### 7. jsonb columns

Use `jsonColumn(sql, value)` from `lib/server/db.ts` as an intent callback:
`intended_payload: (sql) => jsonColumn(sql, payload)`. `sql` is contextually
typed (`IntentValue`); no annotation is needed unless the module supplies its
own `TIntent` (posts).

### 8. validate and readback return values

`validate` may return anything (`Promise<unknown>`), so pass the provider call
itself. `readback.verify` may return the readback hash string instead of `true`
to skip a second hashing pass in `hash`.

## Ambiguous vs failed — the classification policy

> **Moved.** The live classification policy is `docs/architecture.md`,
> "Ambiguous, failed, and interrupted writes".

```
phase        error                                    settled as   thrown
validate     anything                                 failed       the error
mutate       GoogleMutationAmbiguousError, "fail"     ambiguous    the error
mutate       GoogleMutationAmbiguousError, "readback" -> continue to readback
mutate       anything else                            failed       the error
readback.read throws (after clean or ambiguous write) ambiguous    the error
readback.verify false                                 failed       502 mismatch
readback.verify/hash throws GoogleMutationAmbiguousError ambiguous the error
readback.verify/hash throws anything else             failed       the error
```

Rationale. `ambiguous` means "the provider state is not known to match the
intent and might" — a write that may or may not have applied. A `validateOnly`
failure cannot have written anything, so it is always `failed`. A readback that
completes makes the provider state known: a match proves the write applied
(succeeded, even after an ambiguous PATCH), a mismatch proves the intent was
not achieved (failed, with the module's mismatch code, 502 by default) — both
are safe to retry from a fresh snapshot. Only a readback that itself fails
leaves the state unknown. Provider error codes recorded on the row come from
`ApiError.code`, else an object's string `code`, else the module's
`failureCode`.

`onAmbiguous: "readback"` and `"fail"` exist so hours (readback) and profile
(fail) keep their current behaviour while migrating; the intended convergence
is "readback" wherever a readback exists, because `docs/architecture.md` says
ambiguous writes are read before any retry.

## In-flight recovery — why an interrupted publish does not strand

> **Moved.** The live recovery rules — the grace window, the three
> readback outcomes and the retention-cron backstop — are in
> `docs/architecture.md`, "Ambiguous, failed, and interrupted writes".

Phase (a) commits the intent in its own transaction and every later phase runs
outside it, so a request that dies in between (function timeout, instance
recycled mid-deploy, a settle transaction that fails to commit) leaves the row
in flight with nothing in this module to move it: no GBP attempt table has a
lease, and `reclaim_expired_jobs` (0029) reaps only the job runner's own three
tables. An unchanged snapshot re-derives the same key, so without recovery the
same publish would 409 until `expires_at` deleted the row — 365 days for hours
and profile, 180 for food menus.

So a "resume" surface 409s an in-flight row only inside `IN_FLIGHT_GRACE_MS`.
Past it the row is treated as interrupted and settled from what the provider
actually holds, exactly as `lib/server/publishing/recover.ts` does for reply
publishes:

```
readback.read throws            -> ambiguous (state still unknown), rethrown
readback.verify true            -> succeeded: settle + onSuccess + audit,
                                   and this request returns `idempotent`
                                   without writing to the provider
readback.verify false or throws -> failed: the intent is demonstrably not
                                   live, so the row is settled and this
                                   request re-arms it and publishes
```

This is safe because the key pins the intent: two requests share a key only
when they intend the same write (module revision + snapshot hashes + payload
hash), so `verify` is comparing the provider against exactly the intent the
stranded row carries. A surface with no `readback` keeps the 409 — there is
nothing to compare against.

That recovery needs a request to arrive, so it only ever reaches a row somebody
comes back to with the SAME key — and the common repair (edit the canonical
resource, publish again) mints a different one. The retention cron reaps what
is left (`app/api/cron/retention/route.ts`): a row still in flight a day later
is settled `ambiguous` with `attempt_interrupted`, which is a settled status,
so the next request for its key re-arms it rather than 409ing on it. The halves
are not interchangeable — a reaper holds no provider credentials and cannot
read anything back, and this path never runs at all for a tenant nobody opens.

## What deliberately does not use runGbpWrite: the reply pipeline

> **Moved.** The live boundary statement is `docs/architecture.md`,
> "Three-phase reply mutation and recovery", and the barrel header of
> `lib/server/publishing.ts`.

`lib/server/publishing/*` (review reply publish / delete) shares this module's
discipline and its `isAmbiguousProviderError` primitive but keeps its own
attempt store and phase machine. Its `publish_attempt` row schedules automatic
retries (`retryable`, `next_attempt_at`, `attempt_no`, 429 back-off) that the
succeeded/failed/ambiguous settle vocabulary here cannot express; an in-flight
or ambiguous row is recovered by readback and intended-body comparison
(`recover.ts`) rather than rejected with a 409; a permanent failure is a 409
rather than a re-arm; and a provider failure is returned as an outcome the
routes map, not thrown. Forcing that through `runGbpWrite` would mean
smuggling the provider error through `settle` and control-flow signals through
`find`. The full boundary statement lives in the barrel header of
`lib/server/publishing.ts`; keep the two in step.
