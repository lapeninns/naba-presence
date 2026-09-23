/**
 * Client health: one word for "is this client's Google working".
 *
 * Derived, never stored. The inputs already exist (connection status,
 * reconnect tasks, how many locations are linked, whether a backfill is
 * running or failed), and a stored column would be a second source of truth
 * that goes stale the moment a token expires.
 *
 * Replaces `useConnectionHealth`, which collapsed EVERY connection in the
 * organisation to one connected/disconnected flag. For an agency that meant
 * one client's broken login was invisible as long as another client's login
 * still worked.
 *
 * Pure and client-safe: no server imports, so the same function runs in the
 * summary query, in the shell's health chip and in tests.
 */

export const CLIENT_HEALTH = [
  "not_connected",
  "disconnected",
  "attention",
  "syncing",
  "healthy",
] as const

export type ClientHealth = (typeof CLIENT_HEALTH)[number]

export type ConnectionHealthInput = {
  status: "active" | "expired" | "revoked" | "error" | "disconnected"
  reconnectRequired: boolean
  /** Last successful token refresh, ISO 8601, or null if never. */
  lastRefreshAt: string | null
}

export type ClientHealthInput = {
  connections: readonly ConnectionHealthInput[]
  linkedLocationCount: number
  /** Backfill state across this client's locations. */
  backfill: { running: number; failed: number }
  /** Injected so the calculation is deterministic in tests. */
  now?: Date
}

/** A refresh older than this reads as "we have not heard from Google lately". */
export const STALE_REFRESH_MS = 24 * 60 * 60 * 1000

/**
 * Worst-first: a client is only `healthy` when nothing else applies.
 *
 * Order matters and is deliberate. `syncing` outranks `attention` for a
 * RUNNING backfill but not for a FAILED one — a first import in progress is
 * not a problem, a failed import is.
 */
export function clientHealth(input: ClientHealthInput): ClientHealth {
  const { connections, linkedLocationCount, backfill } = input
  const now = input.now ?? new Date()

  // Nothing linked yet: not broken, just not set up. The distinction matters
  // because the fix is "finish setup", not "reconnect".
  if (linkedLocationCount === 0 || connections.length === 0)
    return "not_connected"

  const active = connections.filter(
    (connection) =>
      connection.status === "active" && !connection.reconnectRequired
  )
  if (active.length === 0) return "disconnected"

  if (backfill.failed > 0) return "attention"
  if (active.length < connections.length) return "attention"

  const stale = active.some((connection) => {
    if (!connection.lastRefreshAt) return false
    const refreshed = Date.parse(connection.lastRefreshAt)
    return (
      Number.isFinite(refreshed) && now.getTime() - refreshed > STALE_REFRESH_MS
    )
  })
  if (stale) return "attention"

  if (backfill.running > 0) return "syncing"
  return "healthy"
}

/** Visual tone for the status pill vocabulary. */
export type HealthTone =
  "healthy" | "attention" | "at-risk" | "pending" | "neutral"

const TONES: Record<ClientHealth, HealthTone> = {
  healthy: "healthy",
  syncing: "pending",
  attention: "attention",
  disconnected: "at-risk",
  not_connected: "neutral",
}

export function healthTone(health: ClientHealth): HealthTone {
  return TONES[health]
}

/** Short label for a chip or a table cell. */
const LABELS: Record<ClientHealth, string> = {
  healthy: "Healthy",
  syncing: "Importing",
  attention: "Needs attention",
  disconnected: "Disconnected",
  not_connected: "Not connected",
}

export function healthLabel(health: ClientHealth): string {
  return LABELS[health]
}

/**
 * One sentence saying what is wrong and what to do, for the client hub header
 * and the attention list. Never mentions a provider code or an internal flag.
 */
export function healthDescription(health: ClientHealth): string {
  switch (health) {
    case "healthy":
      return "Reviews and profile changes are syncing with Google."
    case "syncing":
      return "Importing this client's review history from Google."
    case "attention":
      return "Some of this client's Google data is not up to date."
    case "disconnected":
      return "Google needs reconnecting before reviews can sync."
    case "not_connected":
      return "No Google listings are linked to this client yet."
  }
}

/**
 * Org-wide roll-up for the shell chip on pages that belong to no one client.
 * Counts, not a single worst-case word: "2 clients need attention" tells an
 * agency where to look; "attention" does not.
 */
export function summariseHealth(healths: readonly ClientHealth[]): {
  tone: HealthTone
  label: string
} {
  if (healths.length === 0) return { tone: "neutral", label: "No clients yet" }
  const broken = healths.filter((health) => health === "disconnected").length
  const attention = healths.filter((health) => health === "attention").length
  const needing = broken + attention
  if (needing > 0) {
    return {
      tone: broken > 0 ? "at-risk" : "attention",
      label:
        needing === 1
          ? "1 client needs attention"
          : `${needing} clients need attention`,
    }
  }
  if (healths.some((health) => health === "syncing")) {
    return { tone: "pending", label: "Importing reviews" }
  }
  if (healths.every((health) => health === "not_connected")) {
    return { tone: "neutral", label: "Not connected yet" }
  }
  return { tone: "healthy", label: "All clients connected" }
}

/**
 * The Clients list's health filter (reference `clients.html`), kept in the
 * address as `?health=`. "Needs attention" includes disconnected clients, so
 * its count matches the shell chip's "N clients need attention".
 */
export const HEALTH_FILTERS = [
  { value: "all", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "disconnected", label: "Disconnected" },
  { value: "not_connected", label: "Not set up" },
] as const

export type HealthFilter = (typeof HEALTH_FILTERS)[number]["value"]

export function isHealthFilter(
  value: string | null | undefined
): value is HealthFilter {
  return HEALTH_FILTERS.some((filter) => filter.value === value)
}

export function healthFilterMatches(
  filter: HealthFilter,
  health: ClientHealth
): boolean {
  switch (filter) {
    case "all":
      return true
    case "attention":
      return health === "attention" || health === "disconnected"
    case "disconnected":
      return health === "disconnected"
    case "not_connected":
      return health === "not_connected"
  }
}

/**
 * A short reason under the health word in the Clients table, from the same
 * inputs the health was derived from. Null when the word says it all.
 */
export function clientHealthNote(client: {
  health: ClientHealth
  connections: readonly ConnectionHealthInput[]
  backfill: { running: number; failed: number }
}): string | null {
  switch (client.health) {
    case "disconnected":
      return "Google login needs reconnecting"
    case "attention": {
      if (client.backfill.failed > 0) return "Review import failed"
      const broken = client.connections.some(
        (connection) =>
          connection.status !== "active" || connection.reconnectRequired
      )
      return broken
        ? "A Google login needs reconnecting"
        : "Google hasn’t refreshed in over a day"
    }
    case "syncing":
      return "Importing review history"
    case "not_connected":
      return "Setup unfinished"
    case "healthy":
      return null
  }
}
