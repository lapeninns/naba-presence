"use client"

import { useCallback, useState } from "react"

import { useToastManager } from "@/components/ui/toast"
import {
  successToastFields,
  type SuccessToastCopy,
} from "@/lib/editors/outcome"
import { describePublishStepError } from "@/lib/errors/action-errors"
import { ApiClientError } from "@/lib/api/client"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

/**
 * What a step's `run` resolves to when it found nothing to send (the saved
 * copy already matches Google). The results list then says so instead of
 * claiming a write that never happened.
 */
export const NOTHING_TO_SEND = "nothing_to_send" as const

export type PublishStep = {
  key: string
  /** Shown in the per-step result list. Sentence case, no trailing period. */
  label: string
  run: () => Promise<unknown>
  /**
   * Where the step writes. `local` saves NabaPresence's own copy; `google`
   * (the default) sends a write to Google. The results list words each one
   * differently, because saving here is not publishing.
   */
  kind?: "local" | "google"
  /**
   * True when the endpoint behind this Google step reads Google back and
   * checks the result matched before it answers success (hours, food menus,
   * the profile publish, business information). A finished verified step is
   * `confirmed_applied`; a finished unverified one is only `sent`. Leave it
   * unset for an endpoint that does not compare a readback.
   */
  verified?: boolean
}

export type PublishStepStatus = "pending" | "running" | "done" | "failed"

export type PublishStepResult = {
  key: string
  label: string
  status: PublishStepStatus
  message?: string
  kind?: "local" | "google"
  /** The API's error code for a failed step, when it sent one. */
  code?: string
  /** A finished step that sent nothing because nothing differed. */
  noop?: boolean
  /** Copied from the step: success means Google was read back and matched. */
  verified?: boolean
}

/**
 * The outcome of a publish whose steps all finished, for its toast: `sent`
 * when any Google write that went out lacks a verified readback, otherwise
 * `confirmed_applied` (every Google write was read back and matched, or the
 * step found Google already matched and sent nothing).
 */
export function publishOutcome(
  results: readonly PublishStepResult[]
): "sent" | "confirmed_applied" {
  return results.some(
    (step) =>
      step.status === "done" &&
      !step.noop &&
      step.kind !== "local" &&
      !step.verified
  )
    ? "sent"
    : "confirmed_applied"
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
  /**
   * A title, or an outcome message whose toast kind follows the outcome. A
   * function receives publishOutcome(results), so a flow that mixes verified
   * and unverified writes words its toast by what actually happened.
   */
  successToast?:
    | SuccessToastCopy
    | ((outcome: ReturnType<typeof publishOutcome>) => SuccessToastCopy)
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
      kind: step.kind ?? "google",
      verified: step.verified,
    }))
    setResults(running)

    let failure: string | null = null
    for (const [index, step] of plan.entries()) {
      running[index] = { ...running[index], status: "running" }
      setResults([...running])
      try {
        const outcome = await step.run()
        running[index] = {
          ...running[index],
          status: "done",
          noop: outcome === NOTHING_TO_SEND,
        }
        setResults([...running])
      } catch (cause) {
        const completed = running
          .slice(0, index)
          .filter((result) => result.status === "done" && !result.noop)
        const progress = completed.some((result) => result.kind === "google")
          ? " Earlier steps were sent to Google. Review the step results before retrying."
          : completed.some((result) => result.kind === "local")
            ? " Completed local saves are kept. No Google step completed successfully."
            : ""
        failure =
          describePublishStepError(cause, step.kind ?? "google") + progress
        running[index] = {
          ...running[index],
          status: "failed",
          message: failure,
          code: cause instanceof ApiClientError ? cause.code : undefined,
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
    if (successToast)
      toasts.add(
        successToastFields(
          typeof successToast === "function"
            ? successToast(publishOutcome(running))
            : successToast
        )
      )
    onSuccess?.()
    return true
  }, [steps, invalidate, queryClient, toasts, successToast, onSuccess])

  return { publish, results, isPublishing, error, reset }
}
