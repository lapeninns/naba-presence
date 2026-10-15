"use client"

import { useCallback, useRef, useState } from "react"

import { useToastManager } from "@/components/ui/toast"
import {
  operationSummarySchema,
  type OperationOutcome,
} from "@/lib/contracts/mutation-operations"
import {
  successToastFields,
  type SuccessToastCopy,
} from "@/lib/editors/outcome"
import {
  describePublishStepError,
  errorOutcome,
  isUnconfirmedFailure,
} from "@/lib/errors/action-errors"
import {
  ApiClientError,
  intentFingerprint,
  isAwaitingApproval,
  mintIntentId,
} from "@/lib/api/client"
import { describeActionError } from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"
import { gbpMutationResultSchema } from "@/lib/contracts/gbp-management"
import { useQueryClient, type QueryKey } from "@tanstack/react-query"

/** The failure toast: six words or fewer, the reason is on the step. */
export const PUBLISH_FAILURE_TOAST = "Publishing stopped. See the steps."

/**
 * What a step's `run` resolves to when it found nothing to send (the saved
 * copy already matches Google). The results list then says so instead of
 * claiming a write that never happened.
 */
export const NOTHING_TO_SEND = "nothing_to_send" as const

/**
 * Handed to a step's `run`. `idFor(body)` is the intent id to send that body
 * under: the same id as last time when this step's last attempt may have
 * been applied and it sends the same body again, otherwise a fresh one.
 */
export type StepIntent = { idFor: (body: unknown) => string | undefined }

export type PublishStep = {
  key: string
  /** Shown in the per-step result list. Sentence case, no trailing period. */
  label: string
  /**
   * Sends the step. Resolve to `NOTHING_TO_SEND` when nothing differed, or
   * to the route's answer: an `operation` in it (lib/contracts/
   * mutation-operations.ts `operationSummarySchema`) is the step's outcome.
   */
  run: (intent: StepIntent) => Promise<unknown>
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
  /**
   * A failed step's one-line reason, without the note about earlier steps
   * that `message` carries. A surface that already states what happened to
   * the other steps shows this instead, so the failure is said once.
   */
  reason?: string
  kind?: "local" | "google"
  /** The API's error code for a failed step, when it sent one. */
  code?: string
  /** A finished step that sent nothing because nothing differed. */
  noop?: boolean
  /** Copied from the step: success means Google was read back and matched. */
  verified?: boolean
  /**
   * The server's word for a finished step (its answer's `operation`), or the
   * best reading of a failed one (`errorOutcome`). See `stepOutcome`.
   */
  outcome?: OperationOutcome
  /** The intent a failed Google step was sent under, to ask its receipt. */
  intentId?: string
}

/** The `operation.outcome` a route answered with, if it sent one. */
function answeredOutcome(answer: unknown): OperationOutcome | undefined {
  if (!answer || typeof answer !== "object") return undefined
  const parsed = operationSummarySchema.safeParse(
    (answer as { operation?: unknown }).operation
  )
  return parsed.success ? parsed.data.outcome : undefined
}

/**
 * One step's state in the shared outcome words. A finished local save is
 * `saved_locally`; a finished Google write is what the server said it was,
 * falling back to `confirmed_applied` for a verified endpoint and `sent` for
 * one that makes no check; a failed step is `failed` unless the error said
 * more (`uncertain`, `rejected`). Null for a step that has not finished, or
 * that sent nothing.
 */
export function stepOutcome(step: PublishStepResult): OperationOutcome | null {
  if (step.status === "failed") return step.outcome ?? "failed"
  if (step.status !== "done" || step.noop) return null
  if (step.kind === "local") return "saved_locally"
  return step.outcome ?? (step.verified ? "confirmed_applied" : "sent")
}

/**
 * The outcome of a publish whose steps all finished, for its toast: the
 * first Google write that went out without being confirmed applied (`sent`
 * for an unverified endpoint, or whatever the server answered, such as
 * `awaiting_confirmation`), otherwise `confirmed_applied` (every Google write
 * was confirmed, or the step found Google already matched and sent nothing).
 */
export function publishOutcome(
  results: readonly PublishStepResult[]
): OperationOutcome {
  for (const step of results) {
    if (step.kind === "local") continue
    const outcome = stepOutcome(step)
    if (outcome && outcome !== "confirmed_applied") return outcome
  }
  return "confirmed_applied"
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
  // Per step key: the intent of an attempt that may have been applied, so
  // "Try again" resends it rather than writing a second time.
  const unconfirmed = useRef(
    new Map<string, { fingerprint: string; intentId: string | undefined }>()
  )

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
    let parked = false
    for (const [index, step] of plan.entries()) {
      running[index] = { ...running[index], status: "running" }
      setResults([...running])
      let sent: { fingerprint: string; intentId: string | undefined } | null =
        null
      const intent: StepIntent = {
        idFor: (body) => {
          const fingerprint = intentFingerprint(body)
          const carried = unconfirmed.current.get(step.key)
          const intentId =
            carried?.fingerprint === fingerprint
              ? carried.intentId
              : mintIntentId()
          sent = { fingerprint, intentId }
          return intentId
        },
      }
      try {
        const answer = await step.run(intent)
        unconfirmed.current.delete(step.key)
        // A reviewed change-set write (business information, attributes,
        // lodging) answers its attempt row: anything short of a confirmed
        // success is not finished, whatever HTTP status carried it.
        const recorded = gbpMutationResultSchema.safeParse(answer)
        if (recorded.success && (recorded.data.status !== "succeeded" || (recorded.data.confirmationState !== undefined && recorded.data.confirmationState !== "confirmed" && recorded.data.confirmationState !== "unrecorded"))) {
          throw new ApiClientError(409, "google_confirmation_required", "Check the recorded outcome in Activity before publishing again.", { mutationId: recorded.data.id })
        }
        running[index] = {
          ...running[index],
          status: "done",
          noop: answer === NOTHING_TO_SEND,
          outcome: answeredOutcome(answer),
        }
        setResults([...running])
      } catch (cause) {
        // Held for a second publisher (two-person mode): the step did what
        // it could, nothing reached Google, and the later steps still run.
        if (isAwaitingApproval(cause)) {
          unconfirmed.current.delete(step.key)
          parked = true
          running[index] = {
            ...running[index],
            status: "done",
            message: describeActionError(cause),
            outcome: "awaiting_approval",
          }
          setResults([...running])
          continue
        }
        if (sent && isUnconfirmedFailure(cause))
          unconfirmed.current.set(step.key, sent)
        else unconfirmed.current.delete(step.key)
        const completed = running
          .slice(0, index)
          .filter((result) => result.status === "done" && !result.noop)
        const progress = completed.some((result) => result.kind === "google")
          ? " Earlier steps were sent to Google. Review the step results before retrying."
          : completed.some((result) => result.kind === "local")
            ? " Completed local saves are kept. No Google step completed successfully."
            : ""
        const reason = describePublishStepError(cause, step.kind ?? "google")
        failure = reason + progress
        running[index] = {
          ...running[index],
          status: "failed",
          message: failure,
          reason,
          code: cause instanceof ApiClientError ? cause.code : undefined,
          outcome: errorOutcome(cause),
          intentId:
            (cause instanceof ApiClientError ? cause.intentId : undefined) ??
            (sent as { intentId: string | undefined } | null)?.intentId,
        }
        setResults([...running])
        break
      }
    }

    for (const queryKey of invalidate ?? [])
      void queryClient.invalidateQueries({ queryKey })
    if (parked)
      void queryClient.invalidateQueries({
        queryKey: queryKeys.listingChangeRequestsAll,
      })

    setPublishing(false)

    if (failure) {
      setError(failure)
      // The step and the surface's banner carry the reason; the toast only
      // says it stopped.
      toasts.add({ title: PUBLISH_FAILURE_TOAST, type: "error" })
      return false
    }
    // A parked step is the news: the surface's own "sent to Google" or
    // "live" words would claim a write that has not happened.
    if (parked) toasts.add(successToastFields({ outcome: "awaiting_approval" }))
    else if (successToast)
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
