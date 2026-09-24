"use client"

import { RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { ApiClientError } from "@/lib/api/client"
import { triggerReviewSync } from "@/lib/api/sync"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"

/**
 * Pulls the newest reviews from Google for this organisation.
 *
 * Owners and admins only: the reconcile route refuses everyone else. A lock
 * already held by the scheduled check comes back as `skipped`, which is not
 * a failure.
 */
export function SyncReviewsButton({ canSync }: { canSync: boolean }) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canSync) return null

  async function run() {
    setPending(true)
    setError(null)
    try {
      const result = await triggerReviewSync()
      if (result.skipped) {
        setError("A sync is already running. Try again in a moment.")
        return
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.reviewCountsAll }),
        queryClient.invalidateQueries({ queryKey: queryKeys.clientsAll }),
      ])
      const failure = result.failures?.[0]?.errorCode
      if (failure) {
        setError(describeActionError(new ApiClientError(502, failure, failure)))
      }
    } catch (caught) {
      setError(describeActionError(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 max-sm:items-stretch">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => void run()}
        pending={pending}
        pendingLabel="Syncing…"
      >
        <RefreshCwIcon aria-hidden data-icon="inline-start" />
        Sync reviews
      </Button>
      {error ? (
        <span
          role="alert"
          className="max-w-72 text-caption text-danger-ink sm:text-right"
        >
          {error}
        </span>
      ) : null}
    </div>
  )
}
