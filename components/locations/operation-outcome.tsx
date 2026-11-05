"use client"

import { useQueryClient } from "@tanstack/react-query"
import * as React from "react"

import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { ApiClientError } from "@/lib/api/client"
import {
  isUnsettledOutcome,
  type OperationOutcome,
} from "@/lib/contracts/mutation-operations"
import { errorOutcome } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import {
  receiptPollDelay,
  useMutationReceipt,
} from "@/lib/queries/use-mutation-receipt"

/**
 * The receipt id to follow after a failed write: the intent it was sent
 * under, when the failure leaves its outcome open (`uncertain`, or another
 * request for it still `sent`). Null for a definite answer, which has
 * nothing more to say.
 */
export function unconfirmedReceiptId(error: unknown): string | null {
  if (!(error instanceof ApiClientError) || !error.intentId) return null
  const outcome = errorOutcome(error)
  return outcome === "uncertain" || outcome === "sent" ? error.intentId : null
}

/**
 * The live outcome of one write the app could not confirm, read from its
 * receipt (`GET /api/mutations/{id}`) and asked again while it is still
 * `sent` or `uncertain`, so the notice moves on by itself when the recovery
 * job settles it ("On Google" only once the receipt says
 * `confirmed_applied`). Words and roles come from OperationOutcomeNotice
 * (components/ui/operation-outcome.tsx), a polite status region.
 *
 * Props
 *   receiptId  the operation or intent id; see `unconfirmedReceiptId`.
 *   fallback   what to show until the receipt has been read, and when no
 *              receipt exists (default `uncertain`).
 *   onSettled  called once when the receipt settles, e.g. to refetch the
 *              resource it changed.
 *   action     the next step for the person ("Check Google").
 */
export function OperationReceiptNotice({
  receiptId,
  fallback = "uncertain",
  onSettled,
  action,
  className,
}: {
  receiptId: string
  fallback?: OperationOutcome
  onSettled?: (outcome: OperationOutcome) => void
  action?: React.ReactNode
  className?: string
}) {
  const client = useQueryClient()
  const receipt = useMutationReceipt(receiptId)
  const outcome = receipt.data?.outcome ?? fallback
  // Mirrors the hook's refetchInterval: once it gives up (poll limit or a
  // failed read) the notice must stop promising another automatic check.
  // Reading dataUpdatedAt subscribes to every re-read, even when the receipt
  // comes back unchanged.
  const asked = receipt.dataUpdatedAt
    ? (client.getQueryState(queryKeys.mutationReceipt(receiptId))
        ?.dataUpdateCount ?? 0)
    : 0
  const polling =
    !receipt.isError &&
    (!receipt.data || receiptPollDelay(Math.max(0, asked - 1)) !== false)
  const settled = receipt.data
    ? !isUnsettledOutcome(receipt.data.outcome)
    : false

  const reported = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (!settled || !receipt.data) return
    const key = `${receiptId}:${receipt.data.outcome}`
    if (reported.current === key) return
    reported.current = key
    onSettled?.(receipt.data.outcome)
  }, [settled, receipt.data, receiptId, onSettled])

  return (
    <OperationOutcomeNotice
      outcome={outcome}
      action={settled ? undefined : action}
      className={className}
      data-receipt-id={receiptId}
    >
      {!isUnsettledOutcome(outcome) ? null : polling ? (
        <> We’re checking again automatically.</>
      ) : (
        <>
          {" "}
          We’ve stopped checking automatically. Check Google before sending
          again.
        </>
      )}
    </OperationOutcomeNotice>
  )
}
