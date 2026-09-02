"use client"

import { useQuery } from "@tanstack/react-query"

import { fetchInvitations } from "@/lib/api/invitations"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useInvitations() {
  return useQuery({ queryKey: queryKeys.invitations, queryFn: (ctx) => fetchInvitations(requestOptions(ctx)) })
}
