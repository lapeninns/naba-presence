"use client"

import { useQuery } from "@tanstack/react-query"

import { ApiClientError } from "@/lib/api/client"
import { fetchMutationReceipt } from "@/lib/api/mutations"
import { isUnsettledOutcome } from "@/lib/contracts/mutation-operations"

import { queryKeys } from "./keys"
import { requestOptions } from "./request-options"

/**
 * How often an unsettled receipt is asked again: soon at first (a write that
 * was only slow settles in seconds), then every minute while the recovery
 * job (`mutation_recover`, first readback two minutes after the write) works
 * on it. After `RECEIPT_POLL_LIMIT` asks the receipt is left as it stands;
 * the notice keeps telling the person to check Google.
 */
export const RECEIPT_POLL_DELAYS_MS = [3_000, 10_000, 30_000, 60_000] as const
export const RECEIPT_POLL_LIMIT = 20

/** The wait before re-ask number `asked` (0-based), or false to stop. */
export function receiptPollDelay(asked: number): number | false {
  if (asked >= RECEIPT_POLL_LIMIT) return false
  return RECEIPT_POLL_DELAYS_MS[
    Math.min(asked, RECEIPT_POLL_DELAYS_MS.length - 1)
  ]!
}

/**
 * The receipt for one change, polled while it is still `sent` or
 * `uncertain` and left alone once it settles. `id` is the operation id or the
 * intent id the change was sent under; null or undefined reads nothing.
 *
 * A 404 means no receipt was recorded under that id (the request never
 * reached the write), which is an answer: it is not retried.
 */
export function useMutationReceipt(id: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.mutationReceipt(id ?? ""),
    queryFn: (ctx) => fetchMutationReceipt(id as string, requestOptions(ctx)),
    enabled: Boolean(id),
    retry: (count, error) =>
      !(error instanceof ApiClientError && error.status === 404) && count < 2,
    refetchOnWindowFocus: false,
    refetchInterval: (query) => {
      const receipt = query.state.data
      if (query.state.status === "error") return false
      if (receipt && !isUnsettledOutcome(receipt.outcome)) return false
      // dataUpdateCount counts the first read too; the re-asks start at 0.
      return receiptPollDelay(Math.max(0, query.state.dataUpdateCount - 1))
    },
  })
}
