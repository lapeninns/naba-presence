"use client"

import { useQuery } from "@tanstack/react-query"
import { z } from "zod"

import { apiFetch } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"
import { requestOptions } from "@/lib/queries/request-options"

const statusSchema = z.object({ enabled: z.boolean() })

/**
 * Whether the organisation has review topics on (S3). False until known,
 * and on any failure: a control that cannot match anything stays hidden.
 */
export function useReviewTopicsEnabled(): boolean {
  const status = useQuery({
    queryKey: queryKeys.analytics("review-topics-status", null),
    queryFn: (ctx) =>
      apiFetch("/api/analytics/review-topics/status", {
        schema: statusSchema,
        ...requestOptions(ctx),
      }),
    staleTime: 5 * 60_000,
  })
  return status.data?.enabled === true
}
