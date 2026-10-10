import "server-only"

import { getDatabase } from "@/lib/server/db"
import {
  getServerEnv,
  type GbpIngestionSurface,
  type GbpWriteSurface,
  type ServerEnv,
} from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * Operator pause controls (ledger OPS-06; migration 0090).
 *
 * Two layers decide whether a scope's work may run:
 *
 *   env flag (lib/server/env.ts)   the hard override. Off pauses the scope
 *                                  whatever the database says; it is read
 *                                  once per process, so it takes a redeploy.
 *   ops_pause_control row          the hot switch. Paused stops the scope on
 *                                  every instance within PAUSE_CACHE_TTL_MS,
 *                                  with no redeploy. It can only add a
 *                                  pause, never lift an env one.
 *
 * The checks sit where work starts, not inside it: the job runner's claim
 * (lib/server/jobs.ts claimableKinds) and provider dispatch
 * (lib/server/gbp-write.ts runGbpWrite and the reply pipeline in
 * lib/server/publishing/*), plus the tick routes whose whole run is one
 * scope (retention, notifications, the review sync ticks).
 *
 * A failed read of the table is unknown, not "not paused". Anything that
 * claims, sends or deletes fails closed on it (`onReadError: "closed"`, the
 * default): the same database is needed for the work itself, so failing
 * open would buy nothing but provider traffic nobody can stop. Reporting
 * fails open (`"open"`): the liveness report must keep alerting on a dead
 * tick even when it cannot tell whether that tick was paused.
 *
 * Rows are written only from the operator connection (scripts/ops-pause.mjs);
 * the runtime role can read them and nothing else.
 */

export const PAUSE_SCOPES = [
  "jobs",
  "publish",
  "sync",
  "notifications",
  "retention",
  "drafts",
  "profileWrites",
  "posts",
  "media",
  "placeActions",
  "foodMenus",
  "performance",
  "keywords",
  // Scopes with no env flag of their own. `scheduled_post` and `bulk` hold
  // off the job tick's publication-schedule and bulk-listing runners
  // (lib/server/jobs.ts runDueJobs); `mutation_recover` the recovery kind.
  // Reserved for work that lands later: billing processing (P07) and
  // invitation email delivery (P06-6).
  "scheduled_post",
  "bulk",
  "billing",
  "mutation_recover",
  "invitation_email",
] as const

export type PauseScope = (typeof PAUSE_SCOPES)[number]

/** The env flag that hard-overrides each scope, where one exists. */
export const PAUSE_ENV_OVERRIDE: Partial<Record<PauseScope, keyof ServerEnv>> =
  {
    jobs: "JOBS_ENABLED",
    publish: "PUBLISH_ENABLED",
    sync: "SYNC_ENABLED",
    notifications: "NOTIFICATIONS_ENABLED",
    retention: "RETENTION_ENABLED",
    drafts: "DRAFTS_ENABLED",
    profileWrites: "GBP_PROFILE_WRITES_ENABLED",
    posts: "GBP_POSTS_ENABLED",
    media: "GBP_MEDIA_ENABLED",
    placeActions: "GBP_PLACE_ACTIONS_ENABLED",
    foodMenus: "GBP_FOOD_MENUS_ENABLED",
    performance: "GBP_PERFORMANCE_ENABLED",
    keywords: "GBP_KEYWORDS_ENABLED",
  }

/**
 * What the table said. `readFailed` means it could not be read, so every
 * scope's database state is unknown.
 */
export type PauseSnapshot = {
  paused: ReadonlySet<PauseScope>
  readFailed: boolean
}

export type ReadErrorMode = "closed" | "open"

export const NO_PAUSES: PauseSnapshot = { paused: new Set(), readFailed: false }

/**
 * The whole decision for one switch: the env flag must be on, and the
 * database must say not paused. `dbPaused` null is an unreadable table,
 * which `onReadError` resolves.
 */
export function effectiveEnabled(
  envEnabled: boolean,
  dbPaused: boolean | null,
  onReadError: ReadErrorMode = "closed"
): boolean {
  if (!envEnabled) return false
  if (dbPaused === null) return onReadError === "open"
  return !dbPaused
}

/** The database's word on one scope; null when the table was unreadable. */
export function dbPaused(
  snapshot: PauseSnapshot,
  scope: PauseScope
): boolean | null {
  if (snapshot.readFailed) return null
  return snapshot.paused.has(scope)
}

function envEnabled(env: ServerEnv, scope: PauseScope): boolean {
  const flag = PAUSE_ENV_OVERRIDE[scope]
  return flag ? Boolean(env[flag]) : true
}

/** Every scope in `scopes` enabled under both layers. */
export function scopesEnabled(
  env: ServerEnv,
  snapshot: PauseSnapshot,
  scopes: readonly PauseScope[],
  onReadError: ReadErrorMode = "closed"
): boolean {
  return scopes.every((scope) =>
    effectiveEnabled(
      envEnabled(env, scope),
      dbPaused(snapshot, scope),
      onReadError
    )
  )
}

/**
 * A provider mutation needs the global publish control and its surface's
 * own: the same pair lib/server/env.ts gbpWritesEnabled checks for the env
 * layer.
 */
export function gbpWriteScopes(surface: GbpWriteSurface): PauseScope[] {
  return ["publish", surface]
}

/** Ingestion surfaces answer to their own scope alone, as in env.ts. */
export function gbpIngestionScopes(surface: GbpIngestionSurface): PauseScope[] {
  return [surface]
}

/** Which of `scopes` are paused, for logs and error details. */
export function pausedScopes(
  env: ServerEnv,
  snapshot: PauseSnapshot,
  scopes: readonly PauseScope[] = PAUSE_SCOPES
): PauseScope[] {
  return scopes.filter((scope) => !scopesEnabled(env, snapshot, [scope]))
}

// ---------------------------------------------------------------------------
// The cached read
// ---------------------------------------------------------------------------

/**
 * How stale a pause may be on an instance. Short, because it is the time
 * between an operator pausing a scope and the last instance stopping; long
 * enough that a busy runner does not read the table per item.
 */
export const PAUSE_CACHE_TTL_MS = 5_000

const isPauseScope = (value: string): value is PauseScope =>
  (PAUSE_SCOPES as readonly string[]).includes(value)

export type PauseReader = {
  read(): Promise<PauseSnapshot>
  invalidate(): void
}

/**
 * A snapshot cache over `load`. Only a successful read is cached: after a
 * failure the next call reads again, so recovery is not delayed by a cached
 * error. Concurrent callers share one in-flight read.
 */
export function createPauseReader(options: {
  load: () => Promise<readonly string[]>
  ttlMs?: number
  now?: () => number
}): PauseReader {
  const ttlMs = options.ttlMs ?? PAUSE_CACHE_TTL_MS
  const now = options.now ?? Date.now
  let cached: { at: number; snapshot: PauseSnapshot } | null = null
  let inFlight: Promise<PauseSnapshot> | null = null
  return {
    read() {
      if (cached && now() - cached.at < ttlMs) {
        return Promise.resolve(cached.snapshot)
      }
      if (inFlight) return inFlight
      const started = now()
      inFlight = options
        .load()
        .then((scopes) => {
          const snapshot: PauseSnapshot = {
            paused: new Set(scopes.filter(isPauseScope)),
            readFailed: false,
          }
          cached = { at: started, snapshot }
          return snapshot
        })
        .catch((error: unknown) => {
          log.error("pause_controls.read_failed", {
            error: error instanceof Error ? error.message : String(error),
          })
          return { paused: new Set<PauseScope>(), readFailed: true }
        })
        .finally(() => {
          inFlight = null
        })
      return inFlight
    },
    invalidate() {
      cached = null
    },
  }
}

const defaultReader = createPauseReader({
  load: async () => {
    // Platform-level read: ops_pause_control holds no tenant data.
    const rows = await getDatabase()<{ scope: string }[]>`
      select scope from ops_pause_control where paused
    `
    return rows.map((row) => row.scope)
  },
})

/** The current pause snapshot, at most PAUSE_CACHE_TTL_MS old. */
export function loadPauseSnapshot(): Promise<PauseSnapshot> {
  return defaultReader.read()
}

/** Drops the cached snapshot (tests; the operator script's own process). */
export function invalidatePauseCache(): void {
  defaultReader.invalidate()
}

/** Whether every scope in `scopes` may run now, under both layers. */
export async function isScopeEnabled(
  scopes: PauseScope | readonly PauseScope[],
  options: { onReadError?: ReadErrorMode; env?: ServerEnv } = {}
): Promise<boolean> {
  const list = typeof scopes === "string" ? [scopes] : scopes
  return scopesEnabled(
    options.env ?? getServerEnv(),
    await loadPauseSnapshot(),
    list,
    options.onReadError
  )
}

export type PausedError = { status?: number; code: string; message: string }

/**
 * Throws the caller's own error (default 503) when any of `scopes` is
 * paused, or when the table is unreadable. `details.pausedScopes` names
 * which, so a paused answer is distinguishable from a failure.
 */
export async function requireScopesEnabled(
  scopes: PauseScope | readonly PauseScope[],
  paused: PausedError,
  options: { env?: ServerEnv; snapshot?: PauseSnapshot } = {}
): Promise<void> {
  const list = typeof scopes === "string" ? [scopes] : scopes
  const env = options.env ?? getServerEnv()
  const snapshot = options.snapshot ?? (await loadPauseSnapshot())
  if (scopesEnabled(env, snapshot, list)) return
  throw new ApiError(paused.status ?? 503, paused.code, paused.message, {
    details: {
      pausedScopes: pausedScopes(env, snapshot, list),
      pauseStateUnknown: snapshot.readFailed,
    },
  })
}

/** The default dispatch refusal for a Google write surface. */
export const GOOGLE_WRITES_PAUSED: PausedError = {
  code: "google_writes_paused",
  message:
    "Changes to Google are paused by an operator. Nothing was sent; try again later.",
}

/**
 * The dispatch gate for a Google write surface: env and database, publish
 * and the surface. Called immediately before anything durable is written
 * for a provider call. Inside a transaction, pass a `snapshot` loaded before
 * it began: an expired cache would otherwise read the table through a second
 * pooled connection while the transaction holds one (lib/server/db.ts).
 */
export function requireGbpDispatch(
  surface: GbpWriteSurface,
  paused: PausedError = GOOGLE_WRITES_PAUSED,
  options: { snapshot?: PauseSnapshot } = {}
): Promise<void> {
  return requireScopesEnabled(gbpWriteScopes(surface), paused, options)
}
