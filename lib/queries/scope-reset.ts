"use client"

import type { QueryClient, QueryKey } from "@tanstack/react-query"
import * as React from "react"

import { setAccessLostHandler, type AccessLost } from "@/lib/api/client"
import { purgeForeignDrafts } from "@/lib/api/draft-stash"
import type { SessionResponse, SessionUser } from "@/lib/contracts/session"

import { queryKeys } from "./keys"

/**
 * Everything about a session that decides what its cached data may show:
 * who, in which organisation, with which role and publish right, and the
 * server's scope fingerprint (location scope and grants; the membership's
 * security version once it exists). Two sessions with the same token may
 * share a cache; any difference resets it.
 */
export function sessionScopeToken(
  session: SessionUser | null | undefined
): string {
  if (!session) return ""
  return [
    session.userId,
    session.organisationId,
    session.role,
    session.canPublish ? "publish" : "no-publish",
    session.scopeFingerprint ?? "",
  ].join("\n")
}

function isSessionKey(key: QueryKey): boolean {
  return key[0] === queryKeys.session[0]
}

/**
 * Drops every cached query except the session itself (which is what told us
 * the scope changed). Unobserved queries are removed outright; mounted ones
 * are reset to their initial state, which empties their data and refetches
 * them under the new scope. `queryClient.clear()` would also empty them, but
 * would leave mounted observers attached to queries that are no longer in
 * the cache, so the screen would neither update nor refetch.
 */
export function resetScopedQueries(client: QueryClient): Promise<void> {
  const predicate = (query: { queryKey: QueryKey }) =>
    !isSessionKey(query.queryKey)
  client.removeQueries({
    predicate: (query) => predicate(query) && query.getObserversCount() === 0,
  })
  return client.resetQueries({ predicate }).catch(() => undefined)
}

const SCOPED_PATH = /^\/api\/(locations|clients)\/([^/?#]+)/

/**
 * The query-key roots of everything cached about the location or client a
 * path names (see the scoping contract in lib/queries/keys.ts).
 */
export function resourcePrefixesForPath(path: string): QueryKey[] {
  const match = SCOPED_PATH.exec(path)
  if (!match) return []
  let id: string
  try {
    id = decodeURIComponent(match[2])
  } catch {
    return []
  }
  if (match[1] === "clients") return [queryKeys.client(id)]
  return [
    ["locations", id],
    queryKeys.locationCapabilities(id),
    queryKeys.listingSummary(id),
    queryKeys.listingChangeRequests(id),
  ]
}

/**
 * Acts on an `AccessLost` answer about a location or client:
 *   * a refused action (a 403 to a write) is not by itself a loss of read
 *     scope, so that resource's queries are refetched in place, keeping what
 *     is on screen (and the editor that is open) until the server says more;
 *   * a refused or hidden read, or a 404 to anything, drops that resource's
 *     cache, so what was readable under a wider scope is not shown again;
 *   * either way the session is refetched, so a real change of role or
 *     grants resets every other cached query now (useScopeReset) rather than
 *     at the next window focus. A 404 also refreshes the directories, which
 *     may no longer list it.
 */
export function dropResourceQueries(
  client: QueryClient,
  lost: AccessLost
): void {
  const prefixes = resourcePrefixesForPath(lost.path)
  if (prefixes.length === 0) return
  // One session refetch however many answers arrive together.
  void client
    .invalidateQueries({ queryKey: queryKeys.session }, { cancelRefetch: false })
    .catch(() => undefined)
  const refusedAction = lost.status === 403 && lost.method !== "GET"
  for (const queryKey of prefixes) {
    if (refusedAction) {
      void client
        .invalidateQueries({ queryKey }, { cancelRefetch: false })
        .catch(() => undefined)
      continue
    }
    client.removeQueries({
      queryKey,
      predicate: (query) => query.getObserversCount() === 0,
    })
    // Only queries still holding data: the refetch a reset starts may be
    // refused again, and a query left with nothing to show must not be
    // reset (and refetched, and refused) for ever. Chosen before the reset,
    // because the reset empties them and its refetch uses the same filter.
    const holding = new Set(
      client
        .getQueryCache()
        .findAll({ queryKey })
        .filter((query) => query.state.data !== undefined)
    )
    if (holding.size === 0) continue
    void client
      .resetQueries({ queryKey, predicate: (query) => holding.has(query) })
      .catch(() => undefined)
  }
  if (lost.status === 404) {
    void client.invalidateQueries({ queryKey: queryKeys.locations })
    void client.invalidateQueries({ queryKey: queryKeys.clients })
  }
}

/**
 * Keeps one query client inside the scope of the session it serves:
 *   * when the session's identity or scope changes (a refetch after a role
 *     or grant change, another account signed in from another tab), every
 *     cached query but the session is dropped;
 *   * once an identity is known, stashed drafts that belong to anyone else
 *     are purged;
 *   * an `AccessLost` answer drops (or, for a refused action, refetches)
 *     that location's or client's cache and refetches the session.
 *
 * The session is read from the cache (the dashboard layout hydrates it and
 * the shell keeps it fresh), never fetched here. A session that goes away
 * (signed out elsewhere) also resets the cache; the drafts stay, for the
 * same person signing back in. The work runs in an effect, after the
 * commit in which the editors switch to their new draft keys, so a draft an
 * editor stashes on that switch is already in storage when the purge runs.
 */
export function useScopeReset(client: QueryClient): void {
  const subscribe = React.useCallback(
    (onChange: () => void) => client.getQueryCache().subscribe(onChange),
    [client]
  )
  const read = React.useCallback(
    () =>
      sessionScopeToken(
        client.getQueryData<SessionResponse>(queryKeys.session)?.session
      ),
    [client]
  )
  const token = React.useSyncExternalStore(subscribe, read, read)
  // The last token seen with a session, and the one seen last of all.
  const known = React.useRef<string | null>(null)
  const last = React.useRef<string | null>(null)

  React.useEffect(() => {
    const previous = last.current
    last.current = token
    if (!token) {
      if (previous) void resetScopedQueries(client)
      return
    }
    const [userId, organisationId] = token.split("\n")
    if (known.current !== null && known.current !== token) {
      void resetScopedQueries(client)
    }
    if (known.current !== token) purgeForeignDrafts({ userId, organisationId })
    known.current = token
  }, [client, token])

  React.useEffect(
    () => setAccessLostHandler((lost) => dropResourceQueries(client, lost)),
    [client]
  )
}
