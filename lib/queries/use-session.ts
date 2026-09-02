"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchSession } from "@/lib/api/session"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: (ctx) => fetchSession(requestOptions(ctx)),
  })
}

export function useSessionRole(): string | null {
  const { data } = useSession()
  return data?.session?.role ?? null
}
