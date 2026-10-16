"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useEffect, useRef, useState } from "react"

import { makeQueryClient } from "./query-client"
import { useScopeReset } from "./scope-reset"

export function QueryProvider({
  children,
  refreshRouterOnScopeChange = false,
}: {
  children: React.ReactNode
  /**
   * Refresh the router when the session's scope changes. Next keeps every
   * page payload it has shown for Back and Forward, and the prefetched ones
   * carry what the old scope could read (#195); a refresh drops them all.
   * On for the dashboard, which is under the app router.
   */
  refreshRouterOnScopeChange?: boolean
}) {
  const [client] = useState(makeQueryClient)
  const refreshRouter = useRef<(() => void) | null>(null)
  // Cached data and stashed drafts follow the session's identity and scope:
  // a change of either drops what the old scope could see.
  useScopeReset(client, () => refreshRouter.current?.())
  return (
    <QueryClientProvider client={client}>
      {refreshRouterOnScopeChange ? (
        <RouterRefresh targetRef={refreshRouter} />
      ) : null}
      {children}
    </QueryClientProvider>
  )
}

function RouterRefresh({
  targetRef,
}: {
  targetRef: React.RefObject<(() => void) | null>
}) {
  const router = useRouter()
  useEffect(() => {
    targetRef.current = () => router.refresh()
    return () => {
      targetRef.current = null
    }
  }, [router, targetRef])
  return null
}
