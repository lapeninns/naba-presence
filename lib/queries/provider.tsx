"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { makeQueryClient } from "./query-client"
import { useScopeReset } from "./scope-reset"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient)
  // Cached data and stashed drafts follow the session's identity and scope:
  // a change of either drops what the old scope could see.
  useScopeReset(client)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
