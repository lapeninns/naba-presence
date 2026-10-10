import "server-only"

/**
 * Recovery of uncertain listing writes: the job runner's `mutation_recover`
 * kind (lib/server/jobs.ts, claim arm in
 * supabase/migrations/0073_mutation_recovery_jobs.sql).
 *
 * A receipt (mutation_operation) is `uncertain` when Google never said
 * whether its write landed. The job reads Google back through the surface's
 * recovery adapter and compares what it holds with the intent the attempt
 * row recorded before dispatch:
 *
 *   landed        attempt `succeeded`, receipt `confirmed_applied` (or
 *                 `awaiting_confirmation` when the readback only identifies
 *                 the write, as a post create matched by content does)
 *   not landed    attempt `failed`, receipt `failed`: nothing applied, so
 *                 the person may send it again
 *   unreadable    back-off; `recovery_attempts` + 1. At the ceiling the
 *                 receipt stays `uncertain`, stops being claimed, and the
 *                 owners and admins are told to check Google
 *   blocked       the connection waits on a reconnect: parked WITHOUT
 *                 spending a readback (as lib/server/jobs.ts
 *                 settleRecoveryFailure does for replies), abandoned after
 *                 RECOVERY_PARK_LIMIT_MS
 *   unverifiable  no readback can identify the write (a media create): the
 *                 receipt stays `uncertain` and a person is told at once
 *
 * The job NEVER sends the write again. Re-sending is a person's decision,
 * taken from a `failed` receipt through the normal editor and pipeline.
 *
 * The readback itself is a provider call made on the actor's behalf, so it
 * is preceded by `recheckAuthorisation` (lib/server/authz/actor.ts): the
 * actor must still be a member who can see the location, and the
 * connection the write went out on must still back it. The credential
 * generation is deliberately not pinned: a reconnect renews the credential
 * of the same connection, and reading through it is how a write parked on
 * that reconnect gets resolved. A refusal stops recovery and notifies.
 *
 * Every settle is conditional on the attempt row still holding the raw
 * status the job read, so an interactive request reconciling the same row
 * (runGbpWrite's own readback) and this job can never both settle it.
 */

import type { TransactionSql } from "postgres"

import { retryDelayMs } from "@/lib/domain/retry"
import { writeAudit } from "@/lib/server/audit"
import {
  recheckAuthorisation,
  type RecheckResult,
} from "@/lib/server/authz/actor"
import { getDatabase, withTenant as defaultWithTenant } from "@/lib/server/db"
import type { AttemptStore, LinkedLocation } from "@/lib/server/gbp-write"
import { connectionAccessToken } from "@/lib/server/google/connections"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"
import {
  abandonRecovery,
  loadUncertainOperation,
  rescheduleRecovery,
  settleRecoveredOperations,
  type RecoveryOperation,
} from "@/lib/server/mutation-operations"
import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import { isScopeEnabled, type PauseScope } from "@/lib/server/pause-controls"

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Readbacks an uncertain receipt gets. Mirrored by `recovery_attempts < 8`
 * in the claim arm (0073), so the ceiling holds even if a settle is lost.
 */
export const MAX_MUTATION_RECOVERY_ATTEMPTS = 8

/** The same curve as reply recovery (lib/server/jobs.ts). */
const RECOVERY_RETRY_BASE_MS = 2_000
const RECOVERY_RETRY_CAP_MS = 300_000

/** How long a reconnect-blocked receipt waits before it looks again. */
export const RECOVERY_PARK_MS = 15 * 60_000

/** How long a receipt may stay reconnect-blocked before it is abandoned. */
export const RECOVERY_PARK_LIMIT_MS = 14 * 24 * 60 * 60_000

/**
 * How long an attempt row may sit in flight before recovery reads it back:
 * runGbpWrite's own IN_FLIGHT_GRACE_MS, for the same reason.
 */
export const IN_FLIGHT_GRACE_MS = 2 * 60_000

/** When a row another request holds is looked at again. */
const MOVED_RETRY_MS = 60_000

/** The scopes the kind answers to, at the claim and again at dispatch. */
export const MUTATION_RECOVER_SCOPES: readonly PauseScope[] = [
  "publish",
  "mutation_recover",
]

// ---------------------------------------------------------------------------
// Adapters
// ---------------------------------------------------------------------------

/** What a readback established about the recorded intent. */
export type RecoveryVerdict =
  | {
      kind: "landed"
      /** True when the readback compared content; false when it only identified the write. */
      confirmed: boolean
      /** Stored on the attempt row, as the surface's own settle stores a readback. */
      response?: unknown
      responseHash?: string | null
    }
  | { kind: "not_landed"; errorCode: string }
  | { kind: "unverifiable"; errorCode: string }

export type SettledVerdict = Exclude<RecoveryVerdict, { kind: "unverifiable" }>

/** The attempt row as an adapter loads it: its own fields plus these. */
export type RecoveryAttempt = {
  id: string
  /** The table's own status value. */
  rawStatus: string
  startedAt: Date | null
}

/**
 * One surface's recovery: how to load the intent its attempt table recorded
 * before dispatch, how to read Google and compare, and how to settle the
 * row (with whatever surface rows the surface's own settle moves).
 */
export type RecoveryAdapter<
  TAttempt extends RecoveryAttempt = RecoveryAttempt,
> = {
  /** mutation_operation.surface */
  surface: string
  /** mutation_operation.attempt_table */
  attemptTable: string
  load(sql: TransactionSql, attemptId: string): Promise<TAttempt | null>
  /** Provider reads only. Throws when Google cannot be read. */
  readback(input: {
    attempt: TAttempt
    link: LinkedLocation
    operation: RecoveryOperation
  }): Promise<RecoveryVerdict>
  /**
   * Settles the attempt row, only while it still holds
   * `attempt.rawStatus`. False: it moved on, nothing was written.
   */
  settle(
    sql: TransactionSql,
    input: { attempt: TAttempt; verdict: SettledVerdict; link: LinkedLocation }
  ): Promise<boolean>
}

/**
 * The settle for a surface on an AttemptStore: `succeeded` with the
 * readback, or `failed` with the verdict's code.
 */
export function storeSettle(
  store: Pick<AttemptStore<unknown>, "settle">
): RecoveryAdapter["settle"] {
  return async (sql, { attempt, verdict }) => {
    const landed = verdict.kind === "landed"
    const written = await store.settle(sql, {
      id: attempt.id,
      status: landed ? "succeeded" : "failed",
      errorCode: landed ? null : verdict.errorCode,
      response: landed ? verdict.response : undefined,
      responseHash: landed ? (verdict.responseHash ?? null) : null,
      expectedStatus: attempt.rawStatus,
    })
    return written !== false
  }
}

export type RecoveryRegistry = ReadonlyMap<string, RecoveryAdapter<never>>

const registryKey = (surface: string, attemptTable: string) =>
  `${surface}:${attemptTable}`

export function createRecoveryRegistry(
  adapters: ReadonlyArray<RecoveryAdapter<never>>
): RecoveryRegistry {
  return new Map(
    adapters.map((adapter) => [
      registryKey(adapter.surface, adapter.attemptTable),
      adapter,
    ])
  )
}

// ---------------------------------------------------------------------------
// Pure decisions
// ---------------------------------------------------------------------------

const IN_FLIGHT_RAW = new Set([
  "validating",
  "validated",
  "publishing",
  "started",
  "importing",
])

/** What an attempt row's own status already says, before any readback. */
export type AttemptState =
  | { kind: "settled"; outcome: "succeeded" | "failed" }
  | { kind: "in_flight"; recoverAt: Date | null }
  | { kind: "unknown" }

export function attemptState(
  attempt: RecoveryAttempt,
  now: Date
): AttemptState {
  if (attempt.rawStatus === "succeeded") {
    return { kind: "settled", outcome: "succeeded" }
  }
  // 'stale' (hours, profile) is a snapshot that moved before dispatch.
  if (attempt.rawStatus === "failed" || attempt.rawStatus === "stale") {
    return { kind: "settled", outcome: "failed" }
  }
  if (IN_FLIGHT_RAW.has(attempt.rawStatus)) {
    const graceEnds = attempt.startedAt
      ? new Date(attempt.startedAt.getTime() + IN_FLIGHT_GRACE_MS)
      : null
    // A row with no start time cannot be told from a live one by age; it is
    // read back anyway, since the receipt says its request is gone.
    if (graceEnds && graceEnds > now) {
      return { kind: "in_flight", recoverAt: graceEnds }
    }
    return { kind: "in_flight", recoverAt: null }
  }
  return { kind: "unknown" }
}

/** The receipt outcome a settled verdict stands for. */
export function verdictOutcome(verdict: SettledVerdict): OperationOutcome {
  if (verdict.kind === "not_landed") return "failed"
  return verdict.confirmed ? "confirmed_applied" : "awaiting_confirmation"
}

export type ConnectionState = "usable" | "blocked" | "disconnected"

/** What a readback that threw does to the receipt. */
export type FailurePlan =
  | { kind: "park"; at: Date }
  | { kind: "abandon"; errorCode: "reconnect_abandoned" }
  | { kind: "reschedule"; at: Date; attempts: number }
  | { kind: "exhausted"; attempts: number }
  | { kind: "disconnected" }

/**
 * The failure ladder, mirroring settleRecoveryFailure for replies: a
 * disconnected connection is final; a reconnect-blocked one parks without
 * spending a readback until the park limit; anything else spends one, up to
 * the ceiling.
 */
export function planRecoveryFailure(input: {
  connection: ConnectionState
  recoveryAttempts: number
  createdAt: Date
  now: Date
  random?: () => number
}): FailurePlan {
  if (input.connection === "disconnected") return { kind: "disconnected" }
  if (input.connection === "blocked") {
    if (
      input.now.getTime() - input.createdAt.getTime() >=
      RECOVERY_PARK_LIMIT_MS
    ) {
      return { kind: "abandon", errorCode: "reconnect_abandoned" }
    }
    return {
      kind: "park",
      at: new Date(input.now.getTime() + RECOVERY_PARK_MS),
    }
  }
  const attempts = input.recoveryAttempts + 1
  if (attempts >= MAX_MUTATION_RECOVERY_ATTEMPTS) {
    return { kind: "exhausted", attempts }
  }
  return {
    kind: "reschedule",
    attempts,
    at: new Date(
      input.now.getTime() +
        retryDelayMs(
          attempts,
          input.random ?? Math.random,
          RECOVERY_RETRY_BASE_MS,
          RECOVERY_RETRY_CAP_MS
        )
    ),
  }
}

/** A provider error that is the credential, not the resource. */
export function isReconnectError(error: unknown): boolean {
  return error instanceof ApiError && Boolean(error.reconnectRequired)
}

// ---------------------------------------------------------------------------
// The session-free location context
// ---------------------------------------------------------------------------

export type RecoveryLink = {
  link: LinkedLocation | null
  connection: ConnectionState
}

type LinkRow = {
  locationId: string
  locationName: string
  timezone: string
  externalLocationId: string
  googleConnectionId: string | null
  googleAccountName: string | null
  googleAccountId: string | null
  googleLocationName: string | null
  connectionStatus: string | null
  reconnectOpen: boolean
}

/**
 * The location's active Google link, without a session: the job acts for a
 * receipt's actor, whose right to it `recheckAuthorisation` decides. A
 * location with no active link (unlinked, disconnected and purged) is
 * `disconnected`: nothing can read it.
 */
export async function loadRecoveryLink(
  sql: TransactionSql,
  organisationId: string,
  locationId: string
): Promise<RecoveryLink> {
  const [row] = await sql<LinkRow[]>`
    select
      l.id::text as "locationId",
      l.name as "locationName",
      l.timezone,
      e.id::text as "externalLocationId",
      e.google_connection_id::text as "googleConnectionId",
      e.google_account_name as "googleAccountName",
      ga.id::text as "googleAccountId",
      e.google_location_name as "googleLocationName",
      gc.status as "connectionStatus",
      exists (
        select 1 from connection_task ct
        where ct.google_connection_id = gc.id
          and ct.task_type = 'reconnect'
          and ct.status = 'open'
      ) as "reconnectOpen"
    from location l
    join location_link ll on ll.location_id = l.id and ll.is_active = true
    join external_location e on e.id = ll.external_location_id
    left join google_connection gc on gc.id = e.google_connection_id
    left join google_account ga
      on ga.google_connection_id = e.google_connection_id
     and ga.google_account_name = e.google_account_name
    where l.id = ${locationId}
    limit 1
  `
  if (
    !row ||
    !row.googleConnectionId ||
    !row.googleAccountName ||
    !row.googleLocationName ||
    row.connectionStatus === null ||
    row.connectionStatus === "disconnected"
  ) {
    return { link: null, connection: "disconnected" }
  }
  const connectionId = row.googleConnectionId
  let token: Promise<string> | undefined
  const link: LinkedLocation = {
    organisationId,
    locationId: row.locationId,
    locationName: row.locationName,
    timezone: row.timezone,
    externalLocationId: row.externalLocationId,
    googleConnectionId: connectionId,
    googleAccountName: row.googleAccountName,
    googleAccountId: row.googleAccountId,
    googleLocationName: row.googleLocationName,
    // Recovery never publishes.
    canPublish: false,
    accessToken: () => {
      if (!token) {
        token = connectionAccessToken(
          getDatabase(),
          organisationId,
          connectionId
        )
        token.catch(() => {
          token = undefined
        })
      }
      return token
    },
  }
  const usable =
    (row.connectionStatus === "active" || row.connectionStatus === "expired") &&
    !row.reconnectOpen
  return { link, connection: usable ? "usable" : "blocked" }
}

// ---------------------------------------------------------------------------
// Notification
// ---------------------------------------------------------------------------

/**
 * Opens the `mutation_unconfirmed` incident for a receipt recovery gave up
 * on and queues it to the owners and admins (the 0050 machinery delivers
 * it). One per receipt: the open-incident index deduplicates a repeat.
 */
export async function notifyUnconfirmed(
  sql: TransactionSql,
  input: {
    operation: RecoveryOperation
    reason: string
    locationName: string | null
  }
): Promise<void> {
  const [incident] = await sql<{ id: string }[]>`
    insert into notification_incident (
      organisation_id, kind, subject_type, subject_id, summary
    )
    values (
      ${input.operation.organisationId}, 'mutation_unconfirmed',
      'mutation_operation', ${input.operation.id},
      ${sql.json({
        surface: input.operation.surface,
        action: input.operation.action,
        reason: input.reason,
        title: input.locationName,
      })}
    )
    on conflict (organisation_id, kind, subject_id) where status = 'open'
    do nothing
    returning id::text as id
  `
  if (!incident) return
  await sql`
    insert into notification_delivery (organisation_id, incident_id, recipient_user_id)
    select ${input.operation.organisationId}, ${incident.id}, m.user_id
    from member m
    where m.organisation_id = ${input.operation.organisationId}
      and m.role in ('owner', 'admin')
    on conflict (incident_id, recipient_user_id, channel) do nothing
  `
}

// ---------------------------------------------------------------------------
// The runner
// ---------------------------------------------------------------------------

export type RecoveryResult =
  | "skipped"
  | "stale"
  | "deferred"
  | "parked"
  | "rescheduled"
  | "confirmed_applied"
  | "awaiting_confirmation"
  | "failed"
  | "abandoned"

/** The ledger writes, behind a seam so the decision logic is testable. */
export type RecoveryLedger = {
  load: typeof loadUncertainOperation
  settle: typeof settleRecoveredOperations
  reschedule: typeof rescheduleRecovery
  abandon: typeof abandonRecovery
}

export type RecoveryDeps = {
  withTenant: <T>(
    organisationId: string,
    callback: (sql: TransactionSql) => Promise<T>
  ) => Promise<T>
  registry: RecoveryRegistry
  ledger: RecoveryLedger
  enabled: () => Promise<boolean>
  recheck: (
    sql: TransactionSql,
    input: Parameters<typeof recheckAuthorisation>[1]
  ) => Promise<RecheckResult>
  loadLink: (
    sql: TransactionSql,
    organisationId: string,
    locationId: string
  ) => Promise<RecoveryLink>
  notify: typeof notifyUnconfirmed
  audit: typeof writeAudit
  now: () => Date
  random: () => number
}

const DEFAULT_LEDGER: RecoveryLedger = {
  load: loadUncertainOperation,
  settle: settleRecoveredOperations,
  reschedule: rescheduleRecovery,
  abandon: abandonRecovery,
}

/** Everything but the registry, which lib/server/mutation-recovery-registry.ts supplies. */
export function defaultRecoveryDeps(registry: RecoveryRegistry): RecoveryDeps {
  return {
    withTenant: defaultWithTenant,
    registry,
    ledger: DEFAULT_LEDGER,
    enabled: () => isScopeEnabled(MUTATION_RECOVER_SCOPES),
    recheck: recheckAuthorisation,
    loadLink: loadRecoveryLink,
    notify: notifyUnconfirmed,
    audit: writeAudit,
    now: () => new Date(),
    random: Math.random,
  }
}

type Prepared =
  | { kind: "done"; result: RecoveryResult }
  | {
      kind: "read"
      operation: RecoveryOperation
      adapter: RecoveryAdapter<RecoveryAttempt>
      attempt: RecoveryAttempt
      link: LinkedLocation
    }

/**
 * Recovers one claimed receipt. Never sends a write. Errors from the
 * adapter's readback are settled here; anything else (the database) is left
 * to the runner, which calls `settleMutationRecoveryFailure`.
 */
export async function recoverMutationOperation(
  input: { organisationId: string; operationId: string; requestId: string },
  deps: RecoveryDeps
): Promise<RecoveryResult> {
  // The dispatch half of the pause: a receipt claimed just before a pause
  // keeps its readback budget. The lease release leaves it due at the lease
  // end, so it comes back once the scope does.
  if (!(await deps.enabled())) return "skipped"

  const { organisationId } = input
  const stop = async (
    sql: TransactionSql,
    operation: RecoveryOperation,
    reason: string,
    locationName: string | null,
    countAttempt = false
  ): Promise<RecoveryResult> => {
    const stopped = await deps.ledger.abandon(sql, {
      operationId: operation.id,
      errorCode: reason,
      countAttempt,
    })
    if (!stopped) return "stale"
    await deps.notify(sql, { operation, reason, locationName })
    await deps.audit(sql, {
      organisationId,
      actorUserId: null,
      action: "mutation.recovery_abandoned",
      subjectType: "mutation_operation",
      subjectId: operation.id,
      requestId: input.requestId,
      metadata: {
        surface: operation.surface,
        action: operation.action,
        attemptId: operation.attemptId,
        reason,
        recoveryAttempts: operation.recoveryAttempts + (countAttempt ? 1 : 0),
      },
    })
    return "abandoned"
  }

  const prepared = await deps.withTenant<Prepared>(
    organisationId,
    async (sql) => {
      const operation = await deps.ledger.load(sql, input.operationId)
      if (!operation) return { kind: "done", result: "stale" }
      const adapter = operation.attemptTable
        ? (deps.registry.get(
            registryKey(operation.surface, operation.attemptTable)
          ) as RecoveryAdapter<RecoveryAttempt> | undefined)
        : undefined
      if (!adapter || !operation.attemptId) {
        return {
          kind: "done",
          result: await stop(sql, operation, "recovery_unsupported", null),
        }
      }
      const attempt = await adapter.load(sql, operation.attemptId)
      if (!attempt) {
        return {
          kind: "done",
          result: await stop(sql, operation, "attempt_missing", null),
        }
      }

      const now = deps.now()
      const state = attemptState(attempt, now)
      if (state.kind === "settled") {
        // Something else settled the row since (an interactive reconcile, or
        // a later request that re-sent the same keyed write): its verdict is
        // this receipt's too.
        await deps.ledger.settle(sql, {
          attemptTable: adapter.attemptTable,
          attemptId: attempt.id,
          state: state.outcome === "succeeded" ? "confirmed_applied" : "failed",
          errorCode: state.outcome === "succeeded" ? null : "attempt_failed",
          receipt: {
            attemptId: attempt.id,
            attemptStatus: state.outcome,
            rawStatus: attempt.rawStatus,
          },
        })
        return {
          kind: "done",
          result:
            state.outcome === "succeeded" ? "confirmed_applied" : "failed",
        }
      }
      if (state.kind === "in_flight" && state.recoverAt) {
        await deps.ledger.reschedule(sql, {
          operationId: operation.id,
          at: state.recoverAt,
          errorCode: "attempt_in_flight",
          countAttempt: false,
        })
        return { kind: "done", result: "deferred" }
      }

      if (!operation.locationId || !operation.actorUserId) {
        return {
          kind: "done",
          result: await stop(
            sql,
            operation,
            !operation.locationId ? "location_missing" : "actor_missing",
            null
          ),
        }
      }
      const { link, connection } = await deps.loadLink(
        sql,
        organisationId,
        operation.locationId
      )
      if (!link || connection === "disconnected") {
        return {
          kind: "done",
          result: await stop(
            sql,
            operation,
            "connection_disconnected",
            link?.locationName ?? null
          ),
        }
      }
      if (connection === "blocked") {
        const plan = planRecoveryFailure({
          connection,
          recoveryAttempts: operation.recoveryAttempts,
          createdAt: operation.createdAt,
          now,
        })
        if (plan.kind === "park") {
          await deps.ledger.reschedule(sql, {
            operationId: operation.id,
            at: plan.at,
            errorCode: "reconnect_blocked",
            countAttempt: false,
          })
          return { kind: "done", result: "parked" }
        }
        return {
          kind: "done",
          result: await stop(
            sql,
            operation,
            "reconnect_abandoned",
            link.locationName
          ),
        }
      }

      // Before the provider call made on the actor's behalf.
      const recheck = await deps.recheck(sql, {
        organisationId,
        actorUserId: operation.actorUserId,
        locationId: operation.locationId,
        action: "read",
        connectionId: operation.googleConnectionId,
      })
      if (!recheck.ok) {
        return {
          kind: "done",
          result: await stop(
            sql,
            operation,
            `recovery_refused_${recheck.reason}`,
            link.locationName
          ),
        }
      }
      return { kind: "read", operation, adapter, attempt, link }
    }
  )
  if (prepared.kind === "done") return prepared.result

  const { operation, adapter, attempt, link } = prepared
  let verdict: RecoveryVerdict
  try {
    verdict = await adapter.readback({ attempt, link, operation })
  } catch (error) {
    return settleReadFailure(input, deps, operation, link, error)
  }

  return deps.withTenant(organisationId, async (sql) => {
    if (verdict.kind === "unverifiable") {
      return stop(sql, operation, verdict.errorCode, link.locationName)
    }
    const written = await adapter.settle(sql, { attempt, verdict, link })
    if (!written) {
      // Another request moved the row on; the next claim reads its status.
      await deps.ledger.reschedule(sql, {
        operationId: operation.id,
        at: new Date(deps.now().getTime() + MOVED_RETRY_MS),
        errorCode: "attempt_moved",
        countAttempt: false,
      })
      return "deferred"
    }
    const outcome = verdictOutcome(verdict)
    const errorCode = verdict.kind === "not_landed" ? verdict.errorCode : null
    await deps.ledger.settle(sql, {
      attemptTable: adapter.attemptTable,
      attemptId: attempt.id,
      state: outcome,
      errorCode,
      receipt: {
        attemptId: attempt.id,
        attemptStatus: verdict.kind === "landed" ? "succeeded" : "failed",
        rawStatus: verdict.kind === "landed" ? "succeeded" : "failed",
      },
    })
    await deps.audit(sql, {
      organisationId,
      actorUserId: null,
      action: "mutation.recovered",
      subjectType: "mutation_operation",
      subjectId: operation.id,
      requestId: input.requestId,
      metadata: {
        surface: operation.surface,
        action: operation.action,
        attemptId: attempt.id,
        outcome,
        errorCode,
      },
    })
    return outcome === "failed"
      ? "failed"
      : (outcome as "confirmed_applied" | "awaiting_confirmation")
  })
}

async function settleReadFailure(
  input: { organisationId: string; operationId: string; requestId: string },
  deps: RecoveryDeps,
  operation: RecoveryOperation,
  link: LinkedLocation,
  error: unknown
): Promise<RecoveryResult> {
  const result = await deps.withTenant(input.organisationId, async (sql) => {
    // The connection may have broken during the read; it decides between
    // a park and a spent readback, as for replies.
    const current = await deps.loadLink(
      sql,
      input.organisationId,
      link.locationId
    )
    const connection: ConnectionState =
      current.connection === "usable" && isReconnectError(error)
        ? "blocked"
        : current.connection
    const plan = planRecoveryFailure({
      connection,
      recoveryAttempts: operation.recoveryAttempts,
      createdAt: operation.createdAt,
      now: deps.now(),
      random: deps.random,
    })
    const errorCode = error instanceof ApiError ? error.code : "readback_failed"
    switch (plan.kind) {
      case "park":
        await deps.ledger.reschedule(sql, {
          operationId: operation.id,
          at: plan.at,
          errorCode: "reconnect_blocked",
          countAttempt: false,
        })
        return "parked" as const
      case "reschedule":
        await deps.ledger.reschedule(sql, {
          operationId: operation.id,
          at: plan.at,
          errorCode,
          countAttempt: true,
        })
        return "rescheduled" as const
      default: {
        const reason =
          plan.kind === "exhausted"
            ? "recovery_exhausted"
            : plan.kind === "disconnected"
              ? "connection_disconnected"
              : plan.errorCode
        const stopped = await deps.ledger.abandon(sql, {
          operationId: operation.id,
          errorCode: reason,
          countAttempt: plan.kind === "exhausted",
        })
        if (!stopped) return "stale" as const
        await deps.notify(sql, {
          operation,
          reason,
          locationName: link.locationName,
        })
        await deps.audit(sql, {
          organisationId: input.organisationId,
          actorUserId: null,
          action: "mutation.recovery_abandoned",
          subjectType: "mutation_operation",
          subjectId: operation.id,
          requestId: input.requestId,
          metadata: {
            surface: operation.surface,
            action: operation.action,
            attemptId: operation.attemptId,
            reason,
            lastErrorCode: errorCode,
            recoveryAttempts:
              plan.kind === "exhausted"
                ? plan.attempts
                : operation.recoveryAttempts,
          },
        })
        return "abandoned" as const
      }
    }
  })
  log[result === "abandoned" ? "error" : "warn"](
    "jobs.mutation_recovery_failed",
    {
      organisationId: input.organisationId,
      operationId: operation.id,
      surface: operation.surface,
      outcome: result,
      error,
    }
  )
  return result
}

/**
 * The runner's fallback when recovery itself threw (the database, not the
 * provider): spends one readback so a poisoned receipt cannot loop, and at
 * the ceiling stops it the same way exhaustion does.
 */
export async function settleMutationRecoveryFailure(
  input: { organisationId: string; operationId: string; requestId: string },
  error: unknown,
  deps: Pick<
    RecoveryDeps,
    "withTenant" | "ledger" | "notify" | "now" | "random"
  >
): Promise<void> {
  await deps.withTenant(input.organisationId, async (sql) => {
    const operation = await deps.ledger.load(sql, input.operationId)
    if (!operation) return
    const plan = planRecoveryFailure({
      connection: "usable",
      recoveryAttempts: operation.recoveryAttempts,
      createdAt: operation.createdAt,
      now: deps.now(),
      random: deps.random,
    })
    if (plan.kind === "reschedule") {
      await deps.ledger.reschedule(sql, {
        operationId: operation.id,
        at: plan.at,
        errorCode: "job_failed",
        countAttempt: true,
      })
      return
    }
    if (
      await deps.ledger.abandon(sql, {
        operationId: operation.id,
        errorCode: "recovery_exhausted",
        countAttempt: true,
      })
    ) {
      await deps.notify(sql, {
        operation,
        reason: "recovery_exhausted",
        locationName: null,
      })
    }
  })
  log.error("jobs.mutation_recovery_errored", {
    organisationId: input.organisationId,
    operationId: input.operationId,
    error,
  })
}
