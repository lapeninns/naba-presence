import type { ClientSummary } from "@/lib/contracts/clients"

export type EmptyReason =
  /** Filters exclude everything; rows exist behind them. */
  | "filtered"
  /** The queue itself is empty; nothing is filtered out. */
  | "queue_empty"
  /** The organisation has no clients at all: nothing to import from yet. */
  | "no_clients"
  /** A connection exists but needs reconnecting. */
  | "disconnected"
  /** No Google account is connected at all. */
  | "not_connected"
  /** An import is queued or under way for at least one location. */
  | "importing"
  /** At least one location's import failed. */
  | "import_failed"
  /** Connected, nothing imported yet, nothing queued. */
  | "never_imported"
  /** Google has been asked and answered; there really are none. */
  | "checked"
  /** Connected, but nothing here can say which of the above it is. */
  | "unknown"

export type EmptyFacts = {
  /** Rows are hidden by the current filters rather than absent. */
  hasActiveFilters: boolean
  /** The queue on screen, when it is not the default. */
  queue?: string
  /** Rows exist somewhere outside the current filters. */
  totalOutsideFilters: number
  /** The shell's connection health for the current scope. */
  connection: "connected" | "disconnected" | "unknown"
  /** Clients in scope. Empty when the list has not loaded. */
  clients: Pick<ClientSummary, "backfill" | "lastSyncAt">[]
  /**
   * The client list has loaded and the organisation has none — the first
   * run. Distinct from `clients: []`, which also means "not loaded yet".
   */
  noClients?: boolean
}

function sum(
  clients: EmptyFacts["clients"],
  pick: (backfill: ClientSummary["backfill"]) => number
): number {
  return clients.reduce((total, client) => total + pick(client.backfill), 0)
}

/**
 * Why this list is empty — but only ever a reason the caller can prove.
 *
 * The inbox used to answer every one of these with the same sentence: "No
 * reviews yet. New Google reviews will appear here as they arrive." Both
 * halves could be false. The first asserts Google has none when nobody has
 * asked; the second promises an arrival that cannot happen until an import
 * runs.
 *
 * The ordering is deliberate and each branch states only what its inputs
 * settle. Note two things this deliberately does NOT claim:
 *
 *  - `importing` does not mean "running right now". `/api/clients` counts
 *    `pending` and `running` checkpoints together, so a queued import that
 *    the runner has not picked up yet is indistinguishable here. The copy for
 *    it must therefore be true of a queued import as well as a live one.
 *  - `checked` is the only branch allowed to say there are none, and it needs
 *    a completed import to say it. Even then it says when Google was last
 *    asked rather than asserting a present-tense fact about Google.
 *
 * `unknown` is a real answer, not a fallback for laziness: with no client
 * data loaded, the honest thing is to describe the list rather than Google.
 */
export function emptyReason(facts: EmptyFacts): EmptyReason {
  if (facts.hasActiveFilters) return "filtered"
  // Reviews exist, and no filter is hiding them: this queue is simply clear.
  // "No reviews match these filters" sent operators hunting for a filter that
  // was never applied — an empty Failed queue is the best possible news, and it
  // should read like it.
  if (facts.totalOutsideFilters > 0) {
    return facts.queue && facts.queue !== "all" ? "queue_empty" : "filtered"
  }
  if (facts.noClients) return "no_clients"
  if (facts.connection === "disconnected") return "disconnected"
  if (facts.clients.length === 0) return "unknown"

  const running = sum(facts.clients, (b) => b.running)
  const failed = sum(facts.clients, (b) => b.failed)
  const succeeded = sum(facts.clients, (b) => b.succeeded)
  const notStarted = sum(facts.clients, (b) => b.notStarted)

  // An import in flight outranks a past failure: something is happening now,
  // and saying so is more useful than reporting a failure it may resolve.
  if (running > 0) return "importing"
  if (failed > 0) return "import_failed"
  if (succeeded > 0) return "checked"
  if (notStarted > 0) return "never_imported"
  // Connected, but no location has a checkpoint of any kind — there is
  // nothing linked to import from.
  return "not_connected"
}

/** Locations counted toward the reason, for copy that names a number. */
export function emptyCounts(facts: EmptyFacts) {
  return {
    running: sum(facts.clients, (b) => b.running),
    failed: sum(facts.clients, (b) => b.failed),
    succeeded: sum(facts.clients, (b) => b.succeeded),
    notStarted: sum(facts.clients, (b) => b.notStarted),
    /** The most recent successful sync across the scope, or null. */
    lastSyncAt: facts.clients
      .map((client) => client.lastSyncAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
  }
}
