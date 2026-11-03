import type { OutboxGroupKey } from "./vocabulary"
import type { OutboxScope } from "./contract"

/**
 * The Outbox's query keys. Kept beside the Outbox rather than in
 * lib/queries/keys.ts, under the same contract: no user or organisation
 * segment (a scope change drops every cached query but the session), and
 * one root, so a send anywhere can refresh the Outbox and its badge with
 * `invalidateQueries({ queryKey: outboxKeys.all })`.
 *
 * The scope segment is `<locationId|all>:<clientId|all>`, so the page and
 * the badge share one cache entry per scope.
 */
const scopeSegment = (scope: OutboxScope = {}) =>
  `${scope.locationId ?? "all"}:${scope.clientId ?? "all"}`

export const outboxKeys = {
  all: ["outbox"] as const,
  list: (scope: OutboxScope = {}, group?: OutboxGroupKey) =>
    ["outbox", "list", scopeSegment(scope), group ?? "all"] as const,
  counts: (scope: OutboxScope = {}) =>
    ["outbox", "counts", scopeSegment(scope)] as const,
}
