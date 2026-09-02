"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchOperationsHealth,
  fetchWebhookFailures,
} from "@/lib/api/operations-health"
import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

export function useOperationsHealth(enabled = true) {
  return useQuery({
    queryKey: queryKeys.operationsHealth,
    queryFn: (ctx) => fetchOperationsHealth(requestOptions(ctx)),
    enabled,
  })
}

export function useWebhookFailures(enabled = true) {
  return useQuery({
    queryKey: queryKeys.webhookFailures,
    queryFn: (ctx) => fetchWebhookFailures(requestOptions(ctx)),
    enabled,
  })
}
