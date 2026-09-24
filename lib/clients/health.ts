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
  /** Last successful token refresh, ISO 8601, or null if never. Informational only. */
  lastRefreshAt: string | null
  /**
   * The last transient failure (Google unavailable, rate limited), cleared
   * by the next success. Set on a connection that is still usable.
   */
  lastErrorCode?: string | null
}

/** When this client's Google data was last successfully checked. */
export type ChecksInput = {
  /**
   * The least recently checked linked listing's last successful review
   * check, or its link time if it has never been checked. The freshness
   * baseline: a client is only as fresh as its stalest listing.
   */
  stalestCheckAt: string | null
  /** The same, without the link-time fallback: null until every listing was checked once. */
  lastSuccessfulCheckAt: string | null
  /** Linked listings the login can no longer reach at Google. */
  accessLost: number
}

export type ClientHealthInput = {
  connections: readonly ConnectionHealthInput[]
  linkedLocationCount: number
  /** Backfill state across this client's locations. */
  backfill: { running: number; failed: number }
  checks?: ChecksInput
  /** Injected so the calculation is deterministic in tests. */
  now?: Date
}

/**
 * How long a listing may go without a successful review check before its
 * data counts as delayed. Reconcile runs every 15 minutes, so an hour is
 * three missed runs: long enough that one slow tick is not an alarm, short
 * enough that a stuck sync is noticed the same morning.
 */
export const FRESHNESS_WINDOW_MS = 60 * 60 * 1000

/**
 * The three states a person sees. Each answers "can I trust what I see, and
 * do I need to do anything?"
 *
 *   up_to_date     checked within the freshness window; nothing to do
 *   data_delayed   Google is slow, rate limiting, or a sync failed; the
 *                  platform is retrying and nobody needs to act
 *   action_needed  a person must restore access: reconnect a login, grant a
 *                  missing permission, or get manager access to a listing
 */
export type FreshnessState = "up_to_date" | "data_delayed" | "action_needed"

export type FreshnessReason =
  | "reconnect_required"
  | "permission_missing"
  | "listing_access_lost"
  | "import_failed"
  | "google_unavailable"
  | "sync_delayed"

export type ClientFreshness = {
  state: FreshnessState
  reason: FreshnessReason | null
  lastSuccessfulCheckAt: string | null
}

const PERMISSION_CODES = new Set(["insufficient_scope", "invalid_scope"])

/**
 * Whether a person has to reconnect this Google login. An `expired` access
 * token is not on the list: it is refreshed on its own, and calling it broken
 * put "Needs reconnecting" beside a client whose health said Up to date.
 * Every surface that marks a login as broken reads this, so the chip, the
 * alert and the health word cannot disagree about the same login.
 */
export function connectionNeedsReconnect(connection: ConnectionHealthInput) {
  return (
    connection.reconnectRequired ||
    connection.status === "revoked" ||
    connection.status === "error" ||
    connection.status === "disconnected"
  )
}

const needsReconnect = connectionNeedsReconnect

/**
 * The client's freshness, worst first. A login that needs reconnecting is
 * action needed even when the client has other working logins: a person has
 * to do something, and "partly working" read as fine. A listing the login
 * cannot reach is action needed too, but reconnecting does not fix it, so
 * it carries its own reason. Everything the platform recovers from on its
 * own is data delayed, never action needed.
 */
export function clientFreshness(input: ClientHealthInput): ClientFreshness {
  const now = input.now ?? new Date()
  const lastSuccessfulCheckAt = input.checks?.lastSuccessfulCheckAt ?? null
  const broken = input.connections.find(needsReconnect)
  if (broken) {
    return {
      state: "action_needed",
      reason: PERMISSION_CODES.has(broken.lastErrorCode ?? "")
        ? "permission_missing"
        : "reconnect_required",
      lastSuccessfulCheckAt,
    }
  }
  if ((input.checks?.accessLost ?? 0) > 0) {
    return { state: "action_needed", reason: "listing_access_lost", lastSuccessfulCheckAt }
  }
  if (input.backfill.failed > 0) {
    return { state: "data_delayed", reason: "import_failed", lastSuccessfulCheckAt }
  }
  const baseline = input.checks?.stalestCheckAt
  const stale =
    baseline !== null &&
    baseline !== undefined &&
    Number.isFinite(Date.parse(baseline)) &&
    now.getTime() - Date.parse(baseline) > FRESHNESS_WINDOW_MS
  const degraded = input.connections.some((connection) => connection.lastErrorCode)
  if (stale) {
    return {
      state: "data_delayed",
      reason: degraded ? "google_unavailable" : "sync_delayed",
      lastSuccessfulCheckAt,
    }
  }
  if (degraded) {
    return { state: "data_delayed", reason: "google_unavailable", lastSuccessfulCheckAt }
  }
  return { state: "up_to_date", reason: null, lastSuccessfulCheckAt }
}

/**
 * The client's one-word health: the three freshness states, plus the two
 * setup states that are not health at all (nothing linked yet; the first
 * import still running).
 *
 * `disconnected` is Action needed and `attention` is Data delayed; the
 * values keep their names so saved `?health=` filters and links still work.
 * Freshness comes from successful checks, never from token refreshes: a
 * quiet client whose checks succeed is up to date however long it has been
 * since a refresh.
 */
export function clientHealth(input: ClientHealthInput): ClientHealth {
  const { connections, linkedLocationCount, backfill } = input

  // Nothing linked yet: not broken, just not set up. The distinction matters
  // because the fix is "finish setup", not "reconnect".
  if (linkedLocationCount === 0 || connections.length === 0)
    return "not_connected"

  const freshness = clientFreshness(input)
  if (freshness.state === "action_needed") return "disconnected"
  if (freshness.state === "data_delayed") return "attention"
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
  healthy: "Up to date",
  syncing: "Importing",
  attention: "Data delayed",
  disconnected: "Action needed",
  not_connected: "Not set up",
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
      return "Reviews and profile data were checked with Google recently."
    case "syncing":
      return "Importing this client's review history from Google."
    case "attention":
      return "Google data is delayed. We retry on our own, so there is nothing for you to do."
    case "disconnected":
      return "Someone needs to restore access before reviews can sync."
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
  const action = healths.filter((health) => health === "disconnected").length
  const delayed = healths.filter((health) => health === "attention").length
  if (action > 0) {
    return {
      tone: "at-risk",
      label:
        action === 1 ? "1 client needs action" : `${action} clients need action`,
    }
  }
  if (delayed > 0) {
    return {
      tone: "attention",
      label:
        delayed === 1
          ? "1 client's data delayed"
          : `${delayed} clients' data delayed`,
    }
  }
  if (healths.some((health) => health === "syncing")) {
    return { tone: "pending", label: "Importing reviews" }
  }
  if (healths.every((health) => health === "not_connected")) {
    return { tone: "neutral", label: "Not connected yet" }
  }
  return { tone: "healthy", label: "All clients up to date" }
}

/**
 * The Clients list's health filter, kept in the address as `?health=`.
 *
 * One vocabulary everywhere: the filter labels, the summary tiles and the
 * status pills all use the health words above, and the buckets do not
 * overlap, so a tile's count is exactly the rows its filter shows. (The
 * filters used to include "Delayed or action needed" beside "Action
 * needed", so one client counted twice and a tile called "Need attention"
 * sat over rows that said "nothing needs doing".)
 *
 * "Up to date" includes clients still importing their history: their checks
 * succeed, and the pill on the row says Importing.
 */
export const HEALTH_FILTERS = [
  { value: "all", label: "All" },
  { value: "disconnected", label: LABELS.disconnected },
  { value: "attention", label: LABELS.attention },
  { value: "healthy", label: LABELS.healthy },
  { value: "not_connected", label: LABELS.not_connected },
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
    case "healthy":
      return health === "healthy" || health === "syncing"
    case "attention":
      return health === "attention"
    case "disconnected":
      return health === "disconnected"
    case "not_connected":
      return health === "not_connected"
  }
}

/**
 * What is wrong with a client that needs a person, and so which action fixes
 * it. The hub shows exactly one alert from this, with that action inside it.
 *
 *   reconnect           a login stopped working: reconnect it
 *   permission_missing  a login was granted without Business Profile access:
 *                       reconnect and tick the permission
 *   access_lost         every login works, but one lost manager access to a
 *                       listing at Google: reconnecting does nothing; the
 *                       business has to add the login back as a manager
 *
 * Null when nothing needs a person. Reads the server's freshness reason
 * first, so it agrees with the health word and the shell banner; an older
 * response without freshness falls back to the connections themselves.
 */
export type ClientDiagnosis<C extends ConnectionHealthInput> = {
  kind: "reconnect" | "permission_missing" | "access_lost"
  /** The login concerned: the broken one, or the one that lost access. */
  connection: C | null
  /** Listings the logins can no longer reach (access_lost only). */
  accessLost: number
}

export function diagnoseClient<C extends ConnectionHealthInput>(client: {
  health: ClientHealth
  connections: readonly C[]
  freshness?: ClientFreshness
  checks?: ChecksInput
}): ClientDiagnosis<C> | null {
  const broken = client.connections.find(connectionNeedsReconnect) ?? null
  const accessLost = client.checks?.accessLost ?? 0
  const reason = client.freshness
    ? client.freshness.reason
    : broken
      ? "reconnect_required"
      : null
  switch (reason) {
    case "reconnect_required":
      return { kind: "reconnect", connection: broken, accessLost }
    case "permission_missing":
      return { kind: "permission_missing", connection: broken, accessLost }
    case "listing_access_lost":
      return {
        kind: "access_lost",
        connection: client.connections[0] ?? null,
        accessLost,
      }
    default:
      return null
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
  freshness?: ClientFreshness
}): string | null {
  switch (client.freshness?.reason ?? null) {
    case "permission_missing":
      return "Google permission missing"
    case "reconnect_required":
      return "A Google login needs reconnecting"
    case "listing_access_lost":
      return "A listing's manager access was removed"
    case "import_failed":
      return "Review import failed; retrying"
    case "google_unavailable":
      return "Google is slow to answer; retrying"
    case "sync_delayed":
      return "Checks are running late; retrying"
    default:
      break
  }
  switch (client.health) {
    case "disconnected":
      return "Google login needs reconnecting"
    case "attention":
      return client.backfill.failed > 0
        ? "Review import failed"
        : "Google data is delayed"
    case "syncing":
      return "Importing review history"
    case "not_connected":
      return "Setup unfinished"
    case "healthy":
      return null
  }
}

/** Plain-language freshness sentence: what happened, and whether to act. */
export function freshnessSentence(freshness: ClientFreshness): string {
  switch (freshness.reason) {
    case "permission_missing":
      return "Google didn't grant permission to manage Business Profiles."
    case "reconnect_required":
      return "Google stopped accepting a connected login. Reconnect it to resume syncing."
    case "listing_access_lost":
      return "A connected login lost manager access to a listing. Ask the business to restore it."
    case "import_failed":
      return "The review import hit a problem. We'll keep trying."
    case "google_unavailable":
      return "Google is slow or limiting requests. We'll keep trying."
    case "sync_delayed":
      return "Checks are running late. We'll keep trying."
    case null:
      return "Up to date."
  }
}
