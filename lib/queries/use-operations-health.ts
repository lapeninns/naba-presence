"use client"

import { useQuery } from "@tanstack/react-query"

import {
  fetchOperationsHealth,
  fetchWebhookFailures,
} from "@/lib/api/operations-health"
import { queryKeys } from "./keys"

export function useOperationsHealth(enabled = true) {
  return useQuery({
    queryKey: queryKeys.operationsHealth,
    queryFn: fetchOperationsHealth,
    staleTime: 30_000,
    enabled,
  })
}

export function useWebhookFailures(enabled = true) {
  return useQuery({
    queryKey: queryKeys.webhookFailures,
    queryFn: fetchWebhookFailures,
    staleTime: 30_000,
    enabled,
  })
}
