"use client"

import { useCallback, useState } from "react"

import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

export type PublishStep = {
  key: string
  /** Shown in the per-step result list. Sentence case, no trailing period. */
  label: string
  run: () => Promise<unknown>
}

export type PublishStepStatus = "pending" | "running" | "done" | "failed"

export type PublishStepResult = {
  key: string
  label: string
  status: PublishStepStatus
  message?: string
}

/**
 * One publish, several requests.
 *
 * Every canonical editor has to save before it can publish (the publish call
 * carries the revision the save produced), and the business profile has three
 * writes behind one button. Before this, each editor asked the operator to
 * press Save and then Publish and to work out for themselves what a half-done
 * sequence meant.
 *
 * So the steps run in order, the first failure stops the rest, and what
 * happened to each one is reported. Queries are invalidated whichever way it
 * ends, because a partial publish still changed the server.
 */
export function usePublishFlow({
  steps,
  invalidate,
  successToast,
  onSuccess,
}: {
  /**
   * The steps to run, built when publishing starts rather than on every
   * render: a step usually closes over the result of the one before it, which
   * is not a thing that exists yet while the editor is only being drawn.
   */
  steps: () => PublishStep[]
  invalidate?: readonly QueryKey[]
  successToast?: string
  onSuccess?: () => void
}) {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const [results, setResults] = useState<PublishStepResult[]>([])
  const [isPublishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = useCallback(() => {
    setResults([])
    setError(null)
  }, [])

  const publish = useCallback(async () => {
    setPublishing(true)
    setError(null)
    const plan = steps()
    const running: PublishStepResult[] = plan.map((step) => ({
      key: step.key,
      label: step.label,
      status: "pending",
    }))
    setResults(running)

    let failure: string | null = null
    for (const [index, step] of plan.entries()) {
      running[index] = { ...running[index], status: "running" }
      setResults([...running])
      try {
        await step.run()
        running[index] = { ...running[index], status: "done" }
        setResults([...running])
      } catch (cause) {
        failure = describeActionError(cause)
        running[index] = {
          ...running[index],
          status: "failed",
          message: failure,
        }
        setResults([...running])
        break
      }
    }

    for (const queryKey of invalidate ?? [])
      void queryClient.invalidateQueries({ queryKey })

    setPublishing(false)

    if (failure) {
      setError(failure)
      toasts.add({ title: failure, type: "error" })
      return false
    }
    if (successToast) toasts.add({ title: successToast, type: "success" })
    onSuccess?.()
    return true
  }, [steps, invalidate, queryClient, toasts, successToast, onSuccess])

  return { publish, results, isPublishing, error, reset }
}
