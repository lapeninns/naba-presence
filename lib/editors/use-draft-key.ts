"use client"

import { QueryClientContext } from "@tanstack/react-query"
import * as React from "react"

import type { SessionResponse } from "@/lib/contracts/session"
import { queryKeys } from "@/lib/queries/keys"

import { draftKey, type DraftIdentity, type DraftScope } from "./draft-key"

/**
 * The signed-in identity, read from the session the dashboard layout
 * hydrates. Reads the cache and never fetches (as `useWorkspaceMode` does);
 * without a query client or a session, the identity is unknown.
 */
export function useDraftIdentity(): DraftIdentity {
  const client = React.useContext(QueryClientContext)
  const subscribe = React.useCallback(
    (onChange: () => void) =>
      client ? client.getQueryCache().subscribe(onChange) : () => {},
    [client]
  )
  const read = React.useCallback(() => {
    const session = client?.getQueryData<SessionResponse>(
      queryKeys.session
    )?.session
    // A string, so the snapshot is stable between cache events.
    return session ? `${session.userId}\n${session.organisationId}` : ""
  }, [client])
  const snapshot = React.useSyncExternalStore(subscribe, read, read)
  return React.useMemo(() => {
    const [userId = null, organisationId = null] = snapshot
      ? snapshot.split("\n")
      : []
    return { userId, organisationId }
  }, [snapshot])
}

/** `draftKey` for the signed-in identity. */
export function useDraftKey(scope: DraftScope): string {
  const identity = useDraftIdentity()
  return draftKey({ ...identity, ...scope })
}
