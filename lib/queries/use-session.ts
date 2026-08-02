"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSession } from "@/lib/api/session"
import { queryKeys } from "./keys"

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 30_000,
  })
}

export function useSessionRole(): string | null {
  const { data } = useSession()
  return data?.session?.role ?? null
}
