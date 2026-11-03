/**
 * The Outbox's query keys. Kept beside the Outbox rather than in
 * lib/queries/keys.ts, under the same contract: no user or organisation
 * segment (a scope change drops every cached query but the session), and
 * one root, so a send anywhere can refresh the Outbox and its badge with
 * `invalidateQueries({ queryKey: outboxKeys.all })`.
 */
export const outboxKeys = {
  all: ["outbox"] as const,
  list: ["outbox", "list"] as const,
  counts: ["outbox", "counts"] as const,
}
