"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import { Button } from "@/components/ui/button"
import { triggerKeywordsSync, triggerPerformanceSync } from "@/lib/api/sync"
import { ApiClientError } from "@/lib/api/client"
import { queryKeys } from "@/lib/queries/keys"

export function RefreshGoogleButton({
  kind,
  canTrigger,
  onDone,
}: {
  kind: "performance" | "keywords"
  canTrigger: boolean
  onDone?: () => void
}) {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!canTrigger) return null

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
      onDone?.()
    } catch (caught) {
      const status = caught instanceof ApiClientError ? caught.status : 0
      setError(
        status === 503
          ? "Refreshing is paused right now. Please try again later."
          : status === 409
            ? "A refresh is already running. Please try again in a moment."
            : "We could not refresh from Google. Please try again."
      )
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={() => void run()}
        disabled={pending}
      >
        {pending ? "Refreshing…" : "Refresh Google data"}
      </Button>
      {error ? (
        <span className="text-caption text-destructive">{error}</span>
      ) : null}
    </div>
  )
}
