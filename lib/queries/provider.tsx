"use client"

import { QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { makeQueryClient } from "./query-client"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient)
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
