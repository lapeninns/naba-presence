"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import { fetchInvitations, resendInvitation } from "@/lib/api/invitations"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useInvitations() {
  return useQuery({ queryKey: queryKeys.invitations, queryFn: (ctx) => fetchInvitations(requestOptions(ctx)) })
}

/**
 * Emails a pending invitation again. The list is refetched either way: a
 * refusal (already sending, rate limited, expired) can mean the row moved.
 */
export function useResendInvitation() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => resendInvitation(id),
    onSettled: () => client.invalidateQueries({ queryKey: queryKeys.invitations }),
  })
}
