"use client"

import { hashKey, QueryClientContext } from "@tanstack/react-query"
import * as React from "react"

import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"

import { workspaceTerms, type WorkspaceMode, type WorkspaceTerms } from "./terms"

/**
 * The session's workspace mode, read from the session the dashboard layout
 * hydrates, so it is known on first paint and follows a session refresh.
 *
 * It reads the cache and never fetches: the shell already owns the session
 * query, and a component rendered without a query client (a bare component
 * test, an error boundary above the provider) gets the agency reading, which
 * is what the product was before business mode existed. Before the session
 * is known, only the local anonymous bootstrap is in that position.
 */
const sessionHash = hashKey(queryKeys.session)

export function useWorkspaceMode(): WorkspaceMode {
  const client = React.useContext(QueryClientContext)
  // Only the session's events. An event for any other key, such as a query
  // built while another component renders (a reader keyed by the role, once
  // the session names it), makes React check this store mid-render and
  // re-render a reader whose new mode is not yet committed: "Cannot update a
  // component while rendering a different component".
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      client
        ? client.getQueryCache().subscribe((event) => {
            if (event.query.queryHash === sessionHash) onChange()
          })
        : () => {},
    [client]
  )
  const read = React.useCallback(
    () =>
      client?.getQueryData<SessionResponse>(queryKeys.session)?.session
        ?.workspaceMode,
    [client]
  )
  return React.useSyncExternalStore(subscribe, read, read) ?? "agency"
}

/** The mode and its word map together, for components that need both. */
export function useWorkspaceTerms(): WorkspaceTerms & { mode: WorkspaceMode } {
  const mode = useWorkspaceMode()
  return { mode, ...workspaceTerms(mode) }
}
