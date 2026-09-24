"use client"

import { RefreshCwIcon } from "lucide-react"
import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"
import { triggerKeywordsSync, triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"

/** What went wrong, in the words the operator can act on. */
export function refreshErrorCopy(caught: unknown): string {
  const status = caught instanceof ApiClientError ? caught.status : 0
  if (status === 503)
    return "Refreshing is paused right now. Please try again later."
  if (status === 409)
    return "A refresh is already running. Please try again in a moment."
  return describeActionError(caught)
}

/**
 * Asks Google for new figures now, rather than at the next scheduled pull.
 *
 * The refresh covers the whole organisation's due listings: the sync
 * endpoints take no client scope (only one Google location, for the
 * scheduler), so a client-scoped report refreshes every client's figures.
 */
export function RefreshGoogleButton({
  canTrigger,
  ...props
}: {
  kind: "performance" | "keywords"
  canTrigger: boolean
  onDone?: () => void
}) {
  if (!canTrigger) return null
  return <RefreshGoogleControl {...props} />
}

function RefreshGoogleControl({
  kind,
  onDone,
}: {
  kind: "performance" | "keywords"
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const toast = useToastManager()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run() {
    setPending(true)
    setError(null)
    try {
      if (kind === "performance") await triggerPerformanceSync()
      else await triggerKeywordsSync()
      await queryClient.invalidateQueries({
        queryKey: queryKeys.analytics(
          kind === "performance" ? "presence" : "keywords",
          {}
        ),
        exact: false,
      })
      toast.add({
        type: "success",
        title: "Refresh started",
        description:
          kind === "performance"
            ? "New figures appear here as Google sends them."
            : "New search terms appear here as Google sends them.",
      })
      onDone?.()
    } catch (caught) {
      setError(refreshErrorCopy(caught))
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1 max-sm:w-full max-sm:items-stretch">
      <Button
        variant="secondary"
        onClick={() => void run()}
        pending={pending}
        pendingLabel="Refreshing…"
      >
        <RefreshCwIcon aria-hidden strokeWidth={1.75} />
        Refresh from Google
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
