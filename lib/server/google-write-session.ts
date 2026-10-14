import "server-only"

import { metrics } from "@opentelemetry/api"
import type { TransactionSql } from "postgres"

import { withSessionConnection } from "@/lib/server/db"
import {
  currentGoogleWriteDeadline,
  GoogleWriteBudgetExhaustedError,
  withGoogleWriteDeadline,
} from "@/lib/server/google/transport"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

export { GoogleWriteBudgetExhaustedError }

/**
 * One Google write session: a per-resource advisory lock held across a live
 * Google read, its checks, the write and its readback, with a time budget
 * (docs/audits/2026-10-14-full-stack-audit, W4-01 / AR-1).
 *
 * The lock stays transaction-scoped on a dedicated session-pooler connection
 * (`withSessionConnection`), as every site took it by hand before. A
 * session-level lock outside a transaction was rejected: it would lose the
 * idle-in-transaction kill, the only bound on a lock held by a frozen
 * instance, orphan the lock if the session URL fell back to the transaction
 * pooler, and drop the tenant context the confirm paths read under. What the
 * primitive adds:
 *
 *   - a deadline below the route's `maxDuration`. Every Google call inside
 *     the session ends by it, and a mutation that could not wait its full
 *     timeout is refused before it is sent (lib/server/google/transport.ts);
 *   - `lock_timeout`, so a busy resource answers 409 `google_write_busy`
 *     within seconds instead of a 30 s statement timeout;
 *   - `idle_in_transaction_session_timeout` and `statement_timeout` set on
 *     the lock connection itself, sized from that deadline, instead of
 *     relying on the runtime role's defaults;
 *   - the receipt is the truth, the lock only advisory: `work` settles its
 *     outcome in its own pooled transactions, so when the lock connection
 *     fails under it (the idle kill 25P03, 57P01, a dropped socket, a failed
 *     COMMIT) the session waits for `work` and returns what it settled,
 *     logged once, never a 5xx for a write Google applied. Mutual exclusion
 *     is lost from that moment, which the budget makes the exception.
 *
 * Because of that last rule `work` must not WRITE through `session.sql`:
 * a write there would be lost with the COMMIT while the caller saw success.
 * It is for reads that need the lock connection's tenant context.
 */

/**
 * Every route that publishes to Google declares `maxDuration = 60`; the
 * default when a caller passes no deadline of its own.
 */
export const GOOGLE_WRITE_MAX_DURATION_MS = 60_000
/**
 * Kept free below `maxDuration`: what the request did before the session,
 * and the response after it.
 */
export const GOOGLE_WRITE_DEADLINE_MARGIN_MS = 10_000
/** The longest a writer waits for a busy resource before its 409. */
export const GOOGLE_WRITE_LOCK_WAIT_MAX_MS = 10_000
/** Time kept for the work after the lock wait: one mutation's timeout. */
const WORK_RESERVE_MS = 20_000
const MIN_LOCK_WAIT_MS = 1_000
/** The runtime role's own statement timeout (lib/server/db.ts). */
const STATEMENT_TIMEOUT_MAX_MS = 30_000
/** Past the deadline before an idle lock connection is killed. */
const IDLE_MARGIN_MS = 5_000

export type GoogleWriteBudget = {
  /** Epoch ms by which every Google call in the session has ended. */
  deadline: number
  lockWaitMs: number
  statementTimeoutMs: number
  idleTimeoutMs: number
}

/**
 * The session's budget, or null when too little time is left to start.
 * `deadline` (epoch ms) is the caller's own, e.g. a request deadline; it is
 * never allowed past `now + maxDurationMs - margin`, so nothing the session
 * sets can outlive the route.
 */
export function googleWriteBudget(input: {
  now: number
  deadline?: number
  maxDurationMs?: number
}): GoogleWriteBudget | null {
  const ceiling =
    input.now +
    (input.maxDurationMs ?? GOOGLE_WRITE_MAX_DURATION_MS) -
    GOOGLE_WRITE_DEADLINE_MARGIN_MS
  const deadline = Math.min(input.deadline ?? ceiling, ceiling)
  const remainingMs = deadline - input.now
  if (remainingMs <= MIN_LOCK_WAIT_MS) return null
  const lockWaitMs = Math.min(
    GOOGLE_WRITE_LOCK_WAIT_MAX_MS,
    Math.max(MIN_LOCK_WAIT_MS, remainingMs - WORK_RESERVE_MS)
  )
  return {
    deadline,
    lockWaitMs,
    statementTimeoutMs: Math.min(STATEMENT_TIMEOUT_MAX_MS, remainingMs),
    idleTimeoutMs: remainingMs + IDLE_MARGIN_MS,
  }
}

/** The resource is held by another writer (a bulk child, another editor). */
export class GoogleWriteBusyError extends ApiError {
  constructor() {
    super(
      409,
      "google_write_busy",
      "Another change to this listing is being sent to Google. Try again in a moment.",
      { retryable: true }
    )
  }
}

export type GoogleWriteSession = {
  /** The lock transaction, for reads only (see the module comment). */
  sql: TransactionSql
  deadline: number
}

export type GoogleWriteSessionOptions<T> = {
  /** Names the caller in logs and metrics, e.g. "hours". */
  surface: string
  /** Advisory lock keys, taken in this order on the one connection. */
  keys: readonly string[]
  /**
   * "wait" (the default) waits up to the lock budget, then answers `busy`;
   * "try" answers `busy` at once if any key is held.
   */
  mode?: "wait" | "try"
  /** Set as `app.organisation_id` on the lock transaction, for RLS reads. */
  organisationId?: string
  /** Epoch ms; see `googleWriteBudget`. */
  deadline?: number
  /**
   * The answer when a key is held. Runs after the lock connection is closed.
   * Defaults to throwing `GoogleWriteBusyError`.
   */
  busy?: () => T | Promise<T>
}

const meter = metrics.getMeter("nabapresence.google_write_session")
const sessionDuration = meter.createHistogram(
  "nabapresence.google_write_session.duration",
  {
    description: "Google write session duration, lock wait included",
    unit: "ms",
  }
)
const lockWait = meter.createHistogram(
  "nabapresence.google_write_session.lock_wait",
  {
    description: "Time spent acquiring a Google write session's locks",
    unit: "ms",
  }
)

class ResourceBusy extends Error {}

function isLockTimeout(error: unknown) {
  return (error as { code?: unknown } | null)?.code === "55P03"
}

export async function withGoogleWriteSession<T>(
  options: GoogleWriteSessionOptions<T>,
  work: (session: GoogleWriteSession) => Promise<T>
): Promise<T> {
  const startedAt = Date.now()
  let outcome = "error"
  // A session nested in another (a bulk child's account lock inside its
  // resource lock) never outlives the outer one.
  const outer = currentGoogleWriteDeadline()
  const budget = googleWriteBudget({
    now: startedAt,
    deadline:
      outer === undefined
        ? options.deadline
        : Math.min(outer, options.deadline ?? outer),
  })
  // Objects, not `let`s: TypeScript does not see assignments made inside
  // the callbacks when it narrows below.
  const state: { work?: Promise<T>; lost?: unknown } = {}
  try {
    if (!budget) {
      outcome = "budget_exhausted"
      throw new GoogleWriteBudgetExhaustedError()
    }
    const value = await withSessionConnection(async (connection) => {
      try {
        return (await connection.begin(async (sql) => {
          await sql`
            select
              set_config('lock_timeout', ${String(budget.lockWaitMs)}, true),
              set_config('statement_timeout', ${String(budget.statementTimeoutMs)}, true),
              set_config('idle_in_transaction_session_timeout', ${String(budget.idleTimeoutMs)}, true)
              ${options.organisationId ? sql`, set_config('app.organisation_id', ${options.organisationId}, true)` : sql``}
          `
          const lockStartedAt = Date.now()
          for (const key of options.keys) {
            if (options.mode === "try") {
              const [claim] = await sql<{ acquired: boolean }[]>`
                select pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) as acquired`
              if (!claim?.acquired) throw new ResourceBusy()
              continue
            }
            try {
              await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`
            } catch (error) {
              if (isLockTimeout(error)) throw new ResourceBusy()
              throw error
            }
          }
          lockWait.record(Date.now() - lockStartedAt, {
            surface: options.surface,
          })
          state.work = withGoogleWriteDeadline(budget.deadline, () =>
            work({ sql, deadline: budget.deadline })
          )
          return state.work
        })) as T
      } catch (error) {
        if (!state.work) throw error
        // The lock connection failed once the work had started: at COMMIT,
        // or mid-work, when postgres.js rejects `begin` as soon as the
        // idle-in-transaction kill closes the socket, while the work is
        // still running. The work's own outcome is the answer; its own
        // failure is rethrown here.
        try {
          const value = await state.work
          state.lost = error
          return value
        } finally {
          // Nothing is left to finish (the rollback, if any, is done), and a
          // graceful end waits out its whole timeout on a connection
          // postgres.js saw reset.
          await connection.end({ timeout: 0 })
        }
      }
    })
    if (state.lost !== undefined) {
      outcome = "lock_lost_after_settle"
      log.warn("google_write_session.lock_lost_after_settle", {
        surface: options.surface,
        durationMs: Date.now() - startedAt,
        error: state.lost,
      })
    } else {
      outcome = "ok"
    }
    return value
  } catch (error) {
    if (error instanceof ResourceBusy) {
      outcome = "busy"
      if (options.busy) return options.busy()
      throw new GoogleWriteBusyError()
    }
    throw error
  } finally {
    sessionDuration.record(Date.now() - startedAt, {
      surface: options.surface,
      outcome,
    })
  }
}
