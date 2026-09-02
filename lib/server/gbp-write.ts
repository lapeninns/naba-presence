import "server-only"

/**
 * gbp-write: THE Google Business Profile write pipeline.
 *
 * Every provider mutation in NabaPresence follows the discipline described in
 * docs/architecture.md ("Standalone canonical resources and Google
 * publication", "Profile and location-content control plane"):
 *
 *   tenant/location permission -> capability + kill switch -> durable intent
 *   -> provider call OUTSIDE any transaction -> readback -> settle -> audit
 *
 * Until Sprint 2 that discipline was hand-copied into hours.ts, profile.ts,
 * media.ts, place-actions.ts, food-menus.ts, posts.ts and publishing.ts. This
 * module is the single implementation those modules migrate onto. It owns:
 *
 *   - loadLinkedLocation   the one "linked Google location" context query
 *   - requireGbpWrite      capability + kill-switch gate (module keeps its code)
 *   - requirePublishGrant  the 403 for members without publish rights
 *   - idempotencyKey       one key recipe
 *   - AttemptStore         the per-module attempt table behind one interface,
 *                          with attemptStore() as the generic implementation
 *   - runGbpWrite          the phase machine (start / validate / publish /
 *                          readback / settle / audit)
 *   - GBP_ATTEMPT_STATUSES the status vocabulary, exported once
 *
 * No schema changes: each module keeps its attempt table and columns, and
 * maps the canonical status vocabulary onto whatever its CHECK constraint
 * allows (see `attemptStore`).
 *
 * =====================================================================
 * MIGRATION GUIDE (for the 2.2-2.7 module agents; hours.ts as the example)
 * =====================================================================
 *
 * 1. Context. Delete the module's private `loadContext` / `contextFor`
 *    (`context`, `postsLocationContext`, ...) and the `google_location_not_linked`
 *    throw. Replace with:
 *
 *        const linked = await withTenant(session.organisationId, (sql) =>
 *          loadLinkedLocation(sql, session, locationId, {
 *            notLinked: { message: "Link this location to Google before managing hours." },
 *          })
 *        )
 *
 *    `LinkedLocation` is a superset of every module's old context type
 *    (locationId, locationName, timezone, externalLocationId,
 *    googleConnectionId, googleAccountName, googleAccountId, googleLocationName,
 *    canPublish, accessToken()). Modules that used a different not-linked code
 *    (posts: `location_not_linked`) pass `notLinked: { code }` to keep it;
 *    modules with their own 404 wording pass `notFound: { code?, message? }`
 *    (a nonexistent id and a hidden-but-existing id both raise it). Do not
 *    catch-and-rethrow the 404 to reword it.
 *    `linked.accessToken()` replaces `connectionAccessToken(getDatabase(), ...)`.
 *
 * 2. Gate. Replace the inline `gbpWritesEnabled` check with
 *    `requireGbpWrite(getServerEnv(), "profileWrites", { status: 409,
 *    code: "hours_publishing_disabled", message: "..." })` and the inline
 *    `canPublish` check with `requirePublishGrant(linked, { code:
 *    "publish_permission_required", message: "..." })`. Codes stay identical.
 *
 * 3. Key. Replace the module's `sha256([...].join(":"))` / template-string
 *    recipe with `idempotencyKey([organisationId, externalLocationId,
 *    "hours_publish", revision, googleHash, payloadHash])`. Same inputs, one
 *    hashing scheme. (Keys derived before migration no longer match; that is
 *    fine because every module's pre-flight snapshot check -- in_sync / stale
 *    -- already covers the exact-repeat case for rows written before this.)
 *
 * 4. Store. Declare the module's attempt table once, at module scope:
 *
 *        const hoursAttempts = attemptStore({
 *          table: "hours_sync_attempt",
 *          columns: { httpStatus: "provider_http_status",
 *                     responseHash: "provider_response_hash",
 *                     validatedAt: "validated_at", startedAt: "started_at" },
 *        })
 *
 *    Tables whose CHECK constraint only knows started/succeeded/failed/
 *    ambiguous (media, place actions, posts, gbp_management_mutation) map the
 *    in-flight statuses: `statuses: { validating: "started", validated:
 *    "started", publishing: "started" }`. Tables with `last_error_code` /
 *    `google_response` / `provider_response` name those columns in `columns`.
 *    If the generic store cannot express a table (posts also flips
 *    gbp_local_post.status on every transition), implement `AttemptStore`
 *    by hand; it is four small functions.
 *
 * 5. Pipeline. Replace the hand-written start/validate/publish/readback/settle
 *    block with one `runGbpWrite` call. Before (hours.ts, abridged):
 *
 *        const attempt = await withTenant(org, async (sql) => {
 *          const [existing] = await sql`select ... where idempotency_key = ${key}`
 *          if (existing?.status === "succeeded") return { ...existing, idempotent: true }
 *          if (existing && ["validating", "validated", "publishing"].includes(existing.status))
 *            throw new ApiError(409, "hours_publish_in_progress", "...")
 *          const [row] = existing ? await sql`update hours_sync_attempt set status = 'validating' ...`
 *                                 : await sql`insert into hours_sync_attempt (...) values (...)`
 *          return { ...row, idempotent: false }
 *        })
 *        if (attempt.idempotent) return { status: "published", attemptId: attempt.id, idempotent: true }
 *        let phase = "validating"
 *        try {
 *          await patchGoogleLocationHours(token, { validateOnly: true, ... })
 *          await withTenant(org, (sql) => sql`update ... set status = 'publishing', validated_at = now()`)
 *          phase = "publishing"
 *          await patchGoogleLocationHours(token, { validateOnly: false, ... })
 *        } catch (error) {
 *          const ambiguous = error instanceof GoogleMutationAmbiguousError && phase === "publishing"
 *          await settleFailure({ status: ambiguous ? "ambiguous" : "failed", code: ... })
 *          if (!ambiguous) throw error
 *        }
 *        const readBack = normalizeGoogleHours(await getGoogleLocation(...))
 *        if (hashHours(readBack) !== live.canonicalHash) {
 *          await settleFailure({ status: "failed", code: "google_readback_mismatch" })
 *          throw new ApiError(502, "google_readback_mismatch", "...")
 *        }
 *        await withTenant(org, async (sql) => {
 *          await sql`update hours_sync_attempt set status = 'succeeded', ...`
 *          await reconcileCanonicalResource({ sql, ... })
 *          await writeAudit(sql, { action: "hours.publish.succeeded", ... })
 *        })
 *        return { status: "published", attemptId: attempt.id, idempotent: false }
 *
 *    After:
 *
 *        const result = await runGbpWrite({
 *          organisationId: session.organisationId,
 *          actorUserId: session.userId,
 *          requestId: input.requestId,
 *          store: hoursAttempts,
 *          key,
 *          intent: {
 *            location_id: locationId,
 *            external_location_id: linked.externalLocationId,
 *            operation: "publish",
 *            pinned_canonical_revision: live.resource.revision,
 *            pinned_canonical_hash: live.canonicalHash,
 *            pinned_google_hash: live.googleHash,
 *            update_mask: live.patch.updateMask,
 *            intended_payload: (sql) => jsonColumn(sql, live.patch.payload),
 *            warnings: (sql) => jsonColumn(sql, live.patch.warnings),
 *          },
 *          inProgress: { code: "hours_publish_in_progress", message: "This publish is already in progress." },
 *          failureCode: "google_hours_publish_failed",
 *          validate: () => patchGoogleLocationHours(token, { validateOnly: true, ... }, opts),
 *          mutate: () => patchGoogleLocationHours(token, { validateOnly: false, ... }, opts),
 *          onAmbiguous: "readback",
 *          readback: {
 *            read: async () => normalizeGoogleHours(await getGoogleLocation(token, name, mask, { ...opts, maxAttempts: 3 })),
 *            verify: ({ readback }) => hashHours(readback) === live.canonicalHash,
 *            hash: hashHours,
 *          },
 *          onSuccess: (sql, ctx) => reconcileCanonicalResource({ sql, ..., googleHash: ctx.readbackHash! }),
 *          audit: (ctx) => ({
 *            action: "hours.publish.succeeded",
 *            subjectType: "hours_sync_attempt",
 *            subjectId: ctx.attemptId,
 *            metadata: { locationId, canonicalRevision: live.resource.revision },
 *          }),
 *        })
 *        return { status: "published", attemptId: result.attemptId, idempotent: result.idempotent }
 *
 *    The module keeps everything before the pipeline (live read, stale
 *    checks, overwrite confirmation, in_sync short-circuit) and everything
 *    after it (response shaping). Delete `settleFailure` / `failAttempt` /
 *    `settle` / `settleMutation` / `createMutation` / `mutation` /
 *    `jsonValue`.
 *
 * 6. Behaviour knobs to preserve the module's current semantics:
 *      onExisting  "resume" (hours, profile, food menus): succeeded -> idempotent,
 *                  in flight -> 409 `inProgress`, terminal failure -> re-arm.
 *                  "replay" (media, place actions, posts, management): any
 *                  existing row for the key is returned as idempotent
 *                  (their keys already include the request id).
 *      retry       attemptStore option; "rearm" reuses the failed row (hours,
 *                  profile), "insert" writes a fresh row keyed
 *                  `${key}:${requestId}` (food menus).
 *      onAmbiguous "readback" (hours, food menus) or "fail" (profile, media,
 *                  place actions, posts). See "Ambiguous vs failed" below.
 *      Place-action create's list-based recovery of an ambiguous create stays
 *      inside its `mutate` function (catch GoogleMutationAmbiguousError, list,
 *      find, return the match or rethrow); the helper then sees either a
 *      response or the original ambiguous error.
 *
 * 7. jsonb columns: use `jsonColumn(sql, value)` from lib/server/db.ts as an
 *    intent callback, `intended_payload: (sql) => jsonColumn(sql, payload)`.
 *    `sql` is contextually typed (`IntentValue`); no annotation is needed
 *    unless the module supplies its own `TIntent` (posts).
 *
 * 8. `validate` may return anything (`Promise<unknown>`), so pass the
 *    provider call itself. `readback.verify` may return the readback hash
 *    string instead of `true` to skip a second hashing pass in `hash`.
 *
 * =====================================================================
 * Ambiguous vs failed -- the classification policy
 * =====================================================================
 *
 *   phase        error                                    settled as   thrown
 *   validate     anything                                 failed       the error
 *   mutate       GoogleMutationAmbiguousError, "fail"     ambiguous    the error
 *   mutate       GoogleMutationAmbiguousError, "readback" -> continue to readback
 *   mutate       anything else                            failed       the error
 *   readback.read throws (after clean or ambiguous write) ambiguous    the error
 *   readback.verify false                                 failed       502 mismatch
 *   readback.verify/hash throws GoogleMutationAmbiguousError ambiguous the error
 *   readback.verify/hash throws anything else             failed       the error
 *
 * Rationale. `ambiguous` means "the provider state is not known to match the
 * intent and might" -- a write that may or may not have applied. A
 * validateOnly failure cannot have written anything, so it is always
 * `failed`. A readback that completes makes the provider state known: a match
 * proves the write applied (succeeded, even after an ambiguous PATCH), a
 * mismatch proves the intent was not achieved (failed, with the module's
 * mismatch code, 502 by default) -- both are safe to retry from a fresh
 * snapshot. Only a readback that itself fails leaves the state unknown.
 * Provider error codes recorded on the row come from `ApiError.code`, else an
 * object's string `code`, else the module's `failureCode`.
 *
 * `onAmbiguous: "readback"` and `"fail"` exist so hours (readback) and profile
 * (fail) keep their current behaviour while migrating; the intended
 * convergence is "readback" wherever a readback exists, because
 * docs/architecture.md says ambiguous writes are read before any retry.
 *
 * =====================================================================
 * What deliberately does NOT use runGbpWrite: the reply pipeline
 * =====================================================================
 *
 * lib/server/publishing/* (review reply publish / delete) shares this
 * module's discipline and its `isAmbiguousProviderError` primitive but keeps
 * its own attempt store and phase machine. Its `publish_attempt` row
 * schedules automatic retries (`retryable`, `next_attempt_at`,
 * `attempt_no`, 429 back-off) that the succeeded/failed/ambiguous settle
 * vocabulary here cannot express; an in-flight or ambiguous row is
 * recovered by readback and intended-body comparison (recover.ts) rather
 * than rejected with a 409; a permanent failure is a 409 rather than a
 * re-arm; and a provider failure is returned as an outcome the routes map,
 * not thrown. Forcing that through `runGbpWrite` would mean smuggling the
 * provider error through `settle` and control-flow signals through `find`.
 * The full boundary statement lives in the barrel header of
 * lib/server/publishing.ts; keep the two in step.
 */

import type { Parameter, TransactionSql } from "postgres"

import { writeAudit } from "@/lib/server/audit"
import { sha256 } from "@/lib/server/crypto"
import {
  getDatabase,
  jsonColumnOrNull,
  withTenant as defaultWithTenant,
  type JsonSql,
} from "@/lib/server/db"
import {
  gbpWritesEnabled,
  type GbpFlags,
  type GbpWriteSurface,
} from "@/lib/server/env"
import { connectionAccessToken } from "@/lib/server/google/connections"
import { GoogleMutationAmbiguousError } from "@/lib/server/google/transport"
import { ApiError } from "@/lib/server/http"
import {
  canPublishLocation,
  requireLocationAccess,
  type GrantScope,
} from "@/lib/server/permissions"

// ---------------------------------------------------------------------------
// Status vocabulary
// ---------------------------------------------------------------------------

/**
 * Canonical attempt statuses. `validating`/`validated`/`publishing` are in
 * flight; `succeeded`/`failed`/`ambiguous` are settled. Tables that only know
 * `started` map the three in-flight values onto it (see `attemptStore`).
 */
export const GBP_ATTEMPT_STATUSES = [
  "validating",
  "validated",
  "publishing",
  "succeeded",
  "failed",
  "ambiguous",
] as const

export type GbpAttemptStatus = (typeof GBP_ATTEMPT_STATUSES)[number]
export type GbpSettledStatus = "succeeded" | "failed" | "ambiguous"

export const GBP_IN_FLIGHT_STATUSES: readonly GbpAttemptStatus[] = [
  "validating",
  "validated",
  "publishing",
]

export function isInFlightStatus(status: string): boolean {
  return (GBP_IN_FLIGHT_STATUSES as readonly string[]).includes(status)
}

// ---------------------------------------------------------------------------
// Linked location context
// ---------------------------------------------------------------------------

export type SessionScope = GrantScope & { organisationId: string }

export type LinkedLocation = {
  organisationId: string
  locationId: string
  locationName: string
  timezone: string
  externalLocationId: string
  googleConnectionId: string
  googleAccountName: string
  /** Null when no `google_account` row exists for the connection/account pair. */
  googleAccountId: string | null
  googleLocationName: string
  canPublish: boolean
  /** Memoised access token for the linked connection (refreshes as needed). */
  accessToken: () => Promise<string>
}

export type LoadLinkedLocationOptions = {
  /**
   * Override the 404 raised when the location does not exist in the tenant
   * OR exists but is hidden from the session (both surface as the same
   * code/message so a hidden id is indistinguishable from a missing one).
   * Defaults to `location_not_found` / "Location not found."
   */
  notFound?: { code?: string; message?: string }
  /** Override the 409 raised when the location has no active Google link. */
  notLinked?: { code?: string; message?: string }
  /** Also require a `google_account` row (raises the not-linked 409 otherwise). */
  requireGoogleAccount?: boolean
}

type LinkedLocationRow = {
  locationId: string
  locationName: string
  timezone: string
  externalLocationId: string | null
  googleConnectionId: string | null
  googleAccountName: string | null
  googleAccountId: string | null
  googleLocationName: string | null
}

/**
 * The single "linked Google location" loader: the location -> active link
 * -> external location -> google account join (which doubles as the
 * within-tenant existence check), then location visibility
 * (`requireLocationAccess`), the `location_not_found` 404 and the
 * `google_location_not_linked` 409, plus the publish grant.
 *
 * Existence is checked before visibility on purpose: a nonexistent id and a
 * hidden-but-existing id both raise the module's `notFound` code/message,
 * never `requireLocationAccess`'s legacy `review_not_found`.
 */
export async function loadLinkedLocation(
  sql: TransactionSql,
  session: SessionScope,
  locationId: string,
  options: LoadLinkedLocationOptions = {}
): Promise<LinkedLocation> {
  const notFound = {
    code: options.notFound?.code ?? "location_not_found",
    message: options.notFound?.message ?? "Location not found.",
  }
  const [row] = await sql<LinkedLocationRow[]>`
    select
      l.id::text as "locationId",
      l.name as "locationName",
      l.timezone,
      e.id::text as "externalLocationId",
      e.google_connection_id::text as "googleConnectionId",
      e.google_account_name as "googleAccountName",
      e.google_location_name as "googleLocationName",
      ga.id::text as "googleAccountId"
    from location l
    left join location_link ll
      on ll.location_id = l.id and ll.is_active = true
    left join external_location e on e.id = ll.external_location_id
    left join google_account ga
      on ga.google_connection_id = e.google_connection_id
     and ga.google_account_name = e.google_account_name
    where l.id = ${locationId}
    limit 1
  `
  if (!row) {
    throw new ApiError(404, notFound.code, notFound.message)
  }
  await requireLocationAccess(sql, session, locationId, notFound)
  const notLinked = () =>
    new ApiError(
      409,
      options.notLinked?.code ?? "google_location_not_linked",
      options.notLinked?.message ?? "Link this location to Google first."
    )
  if (
    !row.externalLocationId ||
    !row.googleConnectionId ||
    !row.googleAccountName ||
    !row.googleLocationName
  ) {
    throw notLinked()
  }
  if (options.requireGoogleAccount && !row.googleAccountId) throw notLinked()

  const organisationId = session.organisationId
  const googleConnectionId = row.googleConnectionId
  let token: Promise<string> | undefined
  return {
    organisationId,
    locationId: row.locationId,
    locationName: row.locationName,
    timezone: row.timezone,
    externalLocationId: row.externalLocationId,
    googleConnectionId,
    googleAccountName: row.googleAccountName,
    googleAccountId: row.googleAccountId,
    googleLocationName: row.googleLocationName,
    canPublish: await canPublishLocation(sql, session, locationId),
    accessToken: () => {
      if (!token) {
        token = connectionAccessToken(
          getDatabase(),
          organisationId,
          googleConnectionId
        )
        token.catch(() => {
          token = undefined
        })
      }
      return token
    },
  }
}

// ---------------------------------------------------------------------------
// Gates
// ---------------------------------------------------------------------------

export type GateError = { status?: number; code: string; message: string }

/**
 * Capability + global kill switch for a write surface. Throws the module's
 * own error (default status 503) when `gbpWritesEnabled` is false.
 */
export function requireGbpWrite(
  env: GbpFlags,
  surface: GbpWriteSurface,
  disabled: GateError
): void {
  if (!gbpWritesEnabled(env, surface)) {
    throw new ApiError(disabled.status ?? 503, disabled.code, disabled.message)
  }
}

/** The member-level publish grant (403 with the module's code). */
export function requirePublishGrant(
  linked: Pick<LinkedLocation, "canPublish">,
  denied: GateError
): void {
  if (!linked.canPublish) {
    throw new ApiError(denied.status ?? 403, denied.code, denied.message)
  }
}

// ---------------------------------------------------------------------------
// Idempotency key
// ---------------------------------------------------------------------------

export type IdempotencyPart =
  | string
  | number
  | boolean
  | null
  | undefined
  | readonly IdempotencyPart[]
  | { readonly [key: string]: IdempotencyPart }

function canonicalJson(value: IdempotencyPart): string {
  if (value === undefined) return "null"
  if (Array.isArray(value)) {
    return `[${(value as readonly IdempotencyPart[]).map(canonicalJson).join(",")}]`
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, IdempotencyPart>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`
  }
  return JSON.stringify(value)
}

/**
 * One idempotency-key recipe: sha256 of the canonical JSON encoding of the
 * tuple (object keys sorted, `undefined` written as null). Put in the tuple
 * exactly what makes two requests "the same write": organisation id, the
 * target (external location / resource name), the operation, the pinned
 * revision and hashes, a payload hash, and -- for request-scoped modules --
 * the request id.
 */
export function idempotencyKey(parts: readonly IdempotencyPart[]): string {
  return sha256(canonicalJson(parts))
}

// ---------------------------------------------------------------------------
// Attempt store
// ---------------------------------------------------------------------------

export type AttemptRow = {
  id: string
  /** Canonical status (see GBP_ATTEMPT_STATUSES); unknown table values pass through. */
  status: GbpAttemptStatus | (string & {})
  /** The status exactly as stored in the module's table. */
  rawStatus: string
}

/**
 * What an intent column may hold when written as-is: postgres.js handles
 * strings, numbers, booleans, arrays and Dates, and `Parameter` is what
 * `jsonColumn(sql, value)` / `sql.json(...)` produce. Plain objects are
 * deliberately excluded -- postgres.js cannot serialise them; use a
 * `jsonColumn` callback instead. `undefined` is written as SQL NULL.
 */
export type IntentColumnValue =
  | Parameter
  | string
  | number
  | boolean
  | Date
  | null
  | undefined
  | readonly unknown[]

/**
 * One intent column: a value written as-is, or a function called with the
 * transaction's `sql` so jsonb columns can use `jsonColumn(sql, value)`.
 * Exactly one member of this union has a call signature, so an inline
 * `(sql) => jsonColumn(sql, payload)` is contextually typed without an
 * annotation under `noImplicitAny`.
 */
export type IntentValue =
  IntentColumnValue | ((sql: TransactionSql) => IntentColumnValue)

/** A module's intent columns (the default `TIntent` for `attemptStore`). */
export type IntentColumns = Record<string, IntentValue>

export type AttemptStartInput<TIntent> = {
  organisationId: string
  actorUserId: string
  requestId: string
  key: string
  intent: TIntent
  /** The row `find` returned (a settled failure being re-armed), if any. */
  existing: AttemptRow | null
}

export type AttemptSettleInput = {
  id: string
  status: GbpSettledStatus
  errorCode: string | null
  response?: unknown
  responseHash?: string | null
  httpStatus?: number | null
}

/**
 * The per-module attempt table behind one interface. All methods run inside
 * the tenant transaction `runGbpWrite` opens for them.
 */
export interface AttemptStore<TIntent = IntentColumns> {
  find(
    sql: TransactionSql,
    input: { organisationId: string; key: string }
  ): Promise<AttemptRow | null>
  /** Insert the intent as `validating` (or re-arm `existing`). */
  start(
    sql: TransactionSql,
    input: AttemptStartInput<TIntent>
  ): Promise<AttemptRow>
  /** Phase (c): the provider call is about to happen; `validated` when validateOnly passed. */
  markPublishing(
    sql: TransactionSql,
    input: { id: string; validated: boolean }
  ): Promise<void>
  settle(sql: TransactionSql, input: AttemptSettleInput): Promise<void>
}

export type AttemptStoreConfig = {
  table: string
  /**
   * Canonical -> table status values. Defaults to identity. Tables whose
   * CHECK constraint lacks the in-flight vocabulary map them, e.g.
   * `{ validating: "started", validated: "started", publishing: "started" }`
   * or, for gbp_management_mutation, `publishing: "validated"`.
   */
  statuses?: Partial<Record<GbpAttemptStatus, string>>
  columns?: {
    /** default "actor_user_id"; null when the table has no actor column */
    actorUserId?: string | null
    /** default "provider_error_code" (use "last_error_code" where applicable) */
    errorCode?: string | null
    /** default "finished_at" */
    finishedAt?: string
    /** e.g. "provider_http_status"; default none */
    httpStatus?: string | null
    /** jsonb column for the provider response, e.g. "google_response" / "provider_response"; default none */
    response?: string | null
    /** e.g. "provider_response_hash"; default none */
    responseHash?: string | null
    /** e.g. "validated_at"; default none */
    validatedAt?: string | null
    /** e.g. "started_at" (reset to now() on re-arm); default none */
    startedAt?: string | null
  }
  /**
   * What `start` does when `find` returned a settled failure:
   * "rearm" (default) updates that row back to `validating`; "insert" writes
   * a fresh row keyed `${key}:${requestId}` (food menus' current behaviour).
   */
  retry?: "rearm" | "insert"
}

/**
 * Generic `AttemptStore` over any table with (id, organisation_id, status,
 * idempotency_key) plus the optional columns named in `config.columns`.
 * Intent columns supplied by the module are inserted verbatim.
 */
export function attemptStore(config: AttemptStoreConfig): AttemptStore {
  const table = config.table
  const columns = {
    actorUserId: "actor_user_id" as string | null,
    errorCode: "provider_error_code" as string | null,
    finishedAt: "finished_at",
    httpStatus: null as string | null,
    response: null as string | null,
    responseHash: null as string | null,
    validatedAt: null as string | null,
    startedAt: null as string | null,
    ...config.columns,
  }
  const toTable = (status: GbpAttemptStatus) =>
    config.statuses?.[status] ?? status
  const toCanonical = (raw: string): AttemptRow["status"] =>
    GBP_ATTEMPT_STATUSES.find((status) => toTable(status) === raw) ?? raw
  const rowOf = (row: { id: string; status: string }): AttemptRow => ({
    id: row.id,
    status: toCanonical(row.status),
    rawStatus: row.status,
  })
  const resolveIntent = (sql: TransactionSql, intent: IntentColumns) =>
    Object.fromEntries(
      Object.entries(intent).map(([column, value]) => [
        column,
        typeof value === "function" ? value(sql) : (value ?? null),
      ])
    )

  return {
    async find(sql, input) {
      const [row] = await sql<{ id: string; status: string }[]>`
        select id::text as id, status
        from ${sql(table)}
        where organisation_id = ${input.organisationId}
          and idempotency_key = ${input.key}
        limit 1
      `
      return row ? rowOf(row) : null
    },

    async start(sql, input) {
      if (input.existing && (config.retry ?? "rearm") === "rearm") {
        const rearm: Record<string, unknown> = {
          status: toTable("validating"),
          [columns.finishedAt]: null,
        }
        if (columns.actorUserId) rearm[columns.actorUserId] = input.actorUserId
        if (columns.errorCode) rearm[columns.errorCode] = null
        const [row] = await sql<{ id: string; status: string }[]>`
          update ${sql(table)}
          set ${sql(rearm)}${columns.startedAt ? sql`, ${sql(columns.startedAt)} = now()` : sql``}
          where id = ${input.existing.id}
          returning id::text as id, status
        `
        return rowOf(row)
      }
      const insert: Record<string, unknown> = {
        organisation_id: input.organisationId,
        status: toTable("validating"),
        idempotency_key: input.existing
          ? `${input.key}:${input.requestId}`
          : input.key,
        ...resolveIntent(sql, input.intent),
      }
      if (columns.actorUserId) insert[columns.actorUserId] = input.actorUserId
      const [row] = await sql<{ id: string; status: string }[]>`
        insert into ${sql(table)} ${sql(insert)}
        returning id::text as id, status
      `
      return rowOf(row)
    },

    async markPublishing(sql, input) {
      const status = toTable("publishing")
      const stampValidated = input.validated && columns.validatedAt
      if (status === toTable("validating") && !stampValidated) return
      await sql`
        update ${sql(table)}
        set status = ${status}${stampValidated ? sql`, ${sql(columns.validatedAt as string)} = now()` : sql``}
        where id = ${input.id}
      `
    },

    async settle(sql, input) {
      const succeeded = input.status === "succeeded"
      const update: Record<string, unknown> = { status: toTable(input.status) }
      if (columns.errorCode) {
        update[columns.errorCode] = succeeded ? null : input.errorCode
      }
      if (columns.httpStatus && input.httpStatus !== undefined) {
        update[columns.httpStatus] = input.httpStatus
      }
      if (columns.response) {
        update[columns.response] = jsonColumnOrNull(sql, input.response)
      }
      if (columns.responseHash) {
        update[columns.responseHash] = input.responseHash ?? null
      }
      const validated =
        succeeded && columns.validatedAt
          ? sql`, ${sql(columns.validatedAt)} = coalesce(${sql(columns.validatedAt)}, now())`
          : sql``
      await sql`
        update ${sql(table)}
        set ${sql(update)}, ${sql(columns.finishedAt)} = now()${validated}
        where id = ${input.id}
      `
    },
  }
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/** `ApiError.code`, else an object's string `code`, else `fallback`. */
export function providerErrorCode(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.code
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { code: unknown }).code === "string"
  ) {
    return (error as { code: string }).code
  }
  return fallback
}

export function isAmbiguousProviderError(error: unknown): boolean {
  return error instanceof GoogleMutationAmbiguousError
}

// ---------------------------------------------------------------------------
// runGbpWrite
// ---------------------------------------------------------------------------

export type TenantTransaction = <T>(
  organisationId: string,
  callback: (sql: TransactionSql) => Promise<T>
) => Promise<T>

export type GbpWriteDeps = {
  /** Test seam; defaults to lib/server/db withTenant. */
  withTenant?: TenantTransaction
}

export type GbpWritePhaseContext = { attemptId: string }

export type GbpReadback<TResponse, TReadback> = {
  /** Read the live provider state after the write (also after an ambiguous write in "readback" mode). */
  read: (input: {
    attemptId: string
    /** Undefined when the write was ambiguous and no response exists. */
    response: TResponse | undefined
    providerAmbiguous: boolean
  }) => Promise<TReadback>
  /**
   * `true` when the readback proves the intent applied, `false` when it
   * proves it did not (-> `mismatch`). May instead return the readback hash
   * as a string, which counts as verified AND becomes `readbackHash`, so a
   * module that hashes to compare does not hash again in `hash`.
   */
  verify: (input: {
    readback: TReadback
    response: TResponse | undefined
  }) => boolean | string
  /**
   * Stored in the store's responseHash column and passed to onSuccess/audit.
   * Not called when `verify` already returned the hash.
   */
  hash?: (readback: TReadback) => string
  /** Thrown (and recorded) when verify is false; default 502 google_readback_mismatch. */
  mismatch?: GateError
}

export type GbpWriteSuccess<TResponse, TReadback> = {
  attemptId: string
  response: TResponse | undefined
  readback: TReadback | undefined
  readbackHash: string | undefined
  /** True when the provider call was ambiguous and the readback confirmed it. */
  providerAmbiguous: boolean
}

export type GbpAuditSpec = {
  action: string
  subjectType: string
  subjectId: string
  metadata?: Record<string, unknown>
}

type GbpWriteBase<TResponse, TReadback, TIntent> = {
  organisationId: string
  actorUserId: string
  requestId: string
  store: AttemptStore<TIntent>
  key: string
  intent: TIntent
  /**
   * "resume" (default): succeeded -> idempotent result; in flight -> 409
   * `inProgress`; settled failure -> store.start re-arms. "replay": any
   * existing row is returned as idempotent.
   */
  onExisting?: "resume" | "replay"
  /** Required for "resume". */
  inProgress?: GateError
  /** Recorded when a thrown error carries no code. */
  failureCode: string
  /**
   * Optional validateOnly provider call; any failure settles `failed`. The
   * resolved value is ignored, so a provider call that returns something can
   * be passed directly without an `async () => { await ... }` wrapper.
   */
  validate?: (ctx: GbpWritePhaseContext) => Promise<unknown>
  /** The real provider call. */
  mutate: (ctx: GbpWritePhaseContext) => Promise<TResponse>
  /** Runs inside the settle transaction after the row is marked succeeded, before the audit. */
  onSuccess?: (
    sql: TransactionSql,
    ctx: GbpWriteSuccess<TResponse, TReadback>
  ) => Promise<void>
  /** Audit event written in the settle transaction (null/undefined skips it). */
  audit?:
    | GbpAuditSpec
    | ((ctx: GbpWriteSuccess<TResponse, TReadback>) => GbpAuditSpec | null)
}

export type GbpWriteInput<TResponse, TReadback, TIntent> =
  | (GbpWriteBase<TResponse, TReadback, TIntent> & {
      onAmbiguous: "readback"
      readback: GbpReadback<TResponse, TReadback>
    })
  | (GbpWriteBase<TResponse, TReadback, TIntent> & {
      onAmbiguous: "fail"
      readback?: GbpReadback<TResponse, TReadback>
    })

export type GbpWriteResult<TResponse, TReadback> =
  | {
      idempotent: true
      attemptId: string
      status: AttemptRow["status"]
      rawStatus: string
    }
  | ({ idempotent: false; status: "succeeded" } & GbpWriteSuccess<
      TResponse,
      TReadback
    >)

type Phase = "validate" | "mutate" | "readback_read" | "readback_verify"

function classifyFailure(
  phase: Phase,
  error: unknown
): Exclude<GbpSettledStatus, "succeeded"> {
  if (phase === "validate") return "failed"
  if (phase === "readback_read") return "ambiguous"
  return isAmbiguousProviderError(error) ? "ambiguous" : "failed"
}

/**
 * The phase machine:
 *   (a) tenant txn: find/start the attempt row as `validating`
 *   (b) outside any txn: optional validateOnly call
 *   (c) tenant txn: mark `publishing`
 *   (d) outside any txn: the provider call
 *   (e) outside any txn: optional readback + verify
 *   (f) tenant txn: settle succeeded (+ onSuccess + audit) or failed/ambiguous
 * Throws exactly what the provider/readback threw (or the mismatch ApiError)
 * after settling, so routes keep their existing error mapping.
 */
export async function runGbpWrite<
  TResponse,
  TReadback = never,
  TIntent = IntentColumns,
>(
  input: GbpWriteInput<TResponse, TReadback, TIntent>,
  deps: GbpWriteDeps = {}
): Promise<GbpWriteResult<TResponse, TReadback>> {
  const withTenant = deps.withTenant ?? defaultWithTenant
  const onExisting = input.onExisting ?? "resume"
  if (onExisting === "resume" && !input.inProgress) {
    throw new Error(
      'runGbpWrite: `inProgress` is required when onExisting is "resume"'
    )
  }

  // (a) durable intent
  const started = await withTenant(input.organisationId, async (sql) => {
    const existing = await input.store.find(sql, {
      organisationId: input.organisationId,
      key: input.key,
    })
    if (existing) {
      if (onExisting === "replay" || existing.status === "succeeded") {
        return { idempotent: true as const, row: existing }
      }
      if (isInFlightStatus(existing.status)) {
        const inProgress = input.inProgress as GateError
        throw new ApiError(
          inProgress.status ?? 409,
          inProgress.code,
          inProgress.message
        )
      }
    }
    const row = await input.store.start(sql, {
      organisationId: input.organisationId,
      actorUserId: input.actorUserId,
      requestId: input.requestId,
      key: input.key,
      intent: input.intent,
      existing,
    })
    return { idempotent: false as const, row }
  })
  if (started.idempotent) {
    return {
      idempotent: true,
      attemptId: started.row.id,
      status: started.row.status,
      rawStatus: started.row.rawStatus,
    }
  }
  const attemptId = started.row.id
  const ctx: GbpWritePhaseContext = { attemptId }

  let phase: Phase = "validate"
  let response: TResponse | undefined
  let readback: TReadback | undefined
  let readbackHash: string | undefined
  let providerAmbiguous = false
  try {
    // (b) validateOnly
    if (input.validate) await input.validate(ctx)
    // (c) publishing
    await withTenant(input.organisationId, (sql) =>
      input.store.markPublishing(sql, {
        id: attemptId,
        validated: Boolean(input.validate),
      })
    )
    // (d) provider call
    phase = "mutate"
    try {
      response = await input.mutate(ctx)
    } catch (error) {
      if (
        input.onAmbiguous !== "readback" ||
        !isAmbiguousProviderError(error)
      ) {
        throw error
      }
      providerAmbiguous = true
    }
    // (e) readback
    if (input.readback) {
      phase = "readback_read"
      readback = await input.readback.read({
        attemptId,
        response,
        providerAmbiguous,
      })
      phase = "readback_verify"
      const verified = input.readback.verify({ readback, response })
      if (verified === false) {
        const mismatch = input.readback.mismatch
        throw new ApiError(
          mismatch?.status ?? 502,
          mismatch?.code ?? "google_readback_mismatch",
          mismatch?.message ?? "Google read-back did not match NabaPresence."
        )
      }
      readbackHash =
        typeof verified === "string"
          ? verified
          : input.readback.hash?.(readback)
    }
  } catch (error) {
    // (f) settle failure
    await withTenant(input.organisationId, (sql) =>
      input.store.settle(sql, {
        id: attemptId,
        status: classifyFailure(phase, error),
        errorCode: providerErrorCode(error, input.failureCode),
      })
    )
    throw error
  }

  // (f) settle success + (g) audit
  const success: GbpWriteSuccess<TResponse, TReadback> = {
    attemptId,
    response,
    readback,
    readbackHash,
    providerAmbiguous,
  }
  await withTenant(input.organisationId, async (sql) => {
    await input.store.settle(sql, {
      id: attemptId,
      status: "succeeded",
      errorCode: null,
      response: readback ?? response,
      responseHash: readbackHash ?? null,
      httpStatus: 200,
    })
    if (input.onSuccess) await input.onSuccess(sql, success)
    const audit =
      typeof input.audit === "function" ? input.audit(success) : input.audit
    if (audit) {
      await writeAudit(sql, {
        organisationId: input.organisationId,
        actorUserId: input.actorUserId,
        action: audit.action,
        subjectType: audit.subjectType,
        subjectId: audit.subjectId,
        requestId: input.requestId,
        metadata: audit.metadata,
      })
    }
  })
  return { idempotent: false, status: "succeeded", ...success }
}

/** Re-export for modules that only need the jsonb helper type. */
export type { JsonSql }
