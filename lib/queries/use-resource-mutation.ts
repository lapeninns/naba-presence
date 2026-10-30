"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query"
import { useRef } from "react"

import { useToastManager } from "@/components/ui/toast"
import {
  intentFingerprint,
  isAwaitingApproval,
  mintIntentId,
} from "@/lib/api/client"
import {
  successToastFields,
  type SuccessToastCopy,
} from "@/lib/editors/outcome"
import {
  describeActionError,
  isUnconfirmedFailure,
  type ActionErrorContext,
} from "@/lib/errors/action-errors"
import { queryKeys } from "@/lib/queries/keys"

/** Handed to `mutationFn` with every call. */
export type MutationIntent = {
  /**
   * The intent this call belongs to, for the `lib/api` wrapper's
   * `{ intentId }` option. A call that repeats an action whose last attempt
   * may have been applied (an uncertain or still-in-flight failure, see
   * `isUnconfirmedFailure`) gets that attempt's id again, so the server
   * answers from its receipt rather than writing twice; any other call --
   * the first, one after a success or a definite failure, or one whose
   * input changed (an edit) -- gets a fresh one. Undefined where the browser
   * offers no UUIDs.
   */
  intentId: string | undefined
}

export type ResourceMutationOptions<TData, TVariables> = {
  mutationFn: (variables: TVariables, intent: MutationIntent) => Promise<TData>
  /**
   * What to refresh after success: query keys from `queryKeys` (each is
   * invalidated, prefix-matched, fire-and-forget) or a custom function for
   * fan-out invalidations.
   */
  invalidate?: readonly QueryKey[] | (() => void)
  /**
   * Success toast: a title, or an outcome message (lib/editors/outcome.ts)
   * whose toast kind and default words follow the outcome, so a write that
   * was only sent is not toasted as a success. A function may return null to
   * skip the toast.
   */
  successToast?:
    | SuccessToastCopy
    | ((data: TData, variables: TVariables) => SuccessToastCopy | null)
  /**
   * Error copy source. Defaults to the shared `describeActionError`; override
   * per call site when a mutation needs bespoke copy. Its result is both
   * toasted and handed to `onError` as `message`.
   */
  errorToast?: (error: unknown) => string
  /**
   * Errors the surface shows itself, beside the control, instead of in a
   * toast (content warnings to acknowledge: `contentWarningFromError`).
   * `onError` still runs for them.
   */
  quietError?: (error: unknown) => boolean
  /**
   * Surface handed to `describeActionError` for the two approval codes whose
   * copy differs between review replies and Google posts. Ignored when
   * `errorToast` is set.
   */
  errorContext?: ActionErrorContext
  /** Extra success work (reset local state, close a dialog). Runs before invalidation. */
  onSuccess?: (data: TData, variables: TVariables) => void
  /**
   * Extra error work; `message` is the already-humanised copy. Runs before the toast.
   * Not called for a write two-person mode held for approval: see `onParked`.
   */
  onError?: (error: unknown, message: string, variables: TVariables) => void
  /**
   * A listing write two-person mode held for a second publisher (a 202,
   * `isAwaitingApproval`): nothing failed and nothing was sent, so it is not
   * an error and `onError` does not run. Close the dialog or reset the form
   * here as on success; the editor's approval panel shows the request, and
   * an info toast says it was sent for approval.
   */
  onParked?: (variables: TVariables) => void
  /**
   * What makes two calls the same action, for reusing an intent on a retry.
   * Defaults to the variables. A `mutationFn` that reads what it sends from
   * render state rather than from its variables (a post publish sends the
   * post as it is now) names that state here -- its revision, say -- so an
   * edit between the attempts mints a new intent instead of earning a 409
   * `intent_conflict`.
   */
  intentKey?: (variables: TVariables) => unknown
}

/**
 * `useMutation` with the three things every location mutation used to hand-
 * write: invalidate on success, toast on success, `describeActionError` toast
 * on error. Returns the plain TanStack mutation (`mutate`, `isPending`, …).
 *
 * Invalidation is fire-and-forget (matching the tabs' previous behaviour), so
 * `isPending` clears as soon as the request resolves, not after the refetch.
 */
export function useResourceMutation<TData = unknown, TVariables = void>(
  options: ResourceMutationOptions<TData, TVariables>
): UseMutationResult<TData, Error, TVariables> {
  const queryClient = useQueryClient()
  const toasts = useToastManager()
  const {
    mutationFn,
    invalidate,
    successToast,
    errorToast,
    quietError,
    errorContext,
    onSuccess,
    onError,
    onParked,
    intentKey,
  } = options
  // Each call's fingerprint and intent, by the variables TanStack hands
  // back to onSuccess/onError, so overlapping calls (two items, or a second
  // click before the first fails) each settle their own entry. And the
  // intents a retry may reuse, one per action whose last call may have
  // applied: an uncertain delete of A stays carried through a success on B.
  const calls = useRef(
    new Map<unknown, { key: string; intentId: string | undefined }>()
  )
  const unconfirmed = useRef(new Map<string, string | undefined>())

  return useMutation<TData, Error, TVariables>({
    // Mutations run without TanStack retries here, so a call is one user
    // action. Pressing the button again after a failure that may have
    // applied is a retry of the same action, and resends its intent.
    mutationFn: (variables: TVariables) => {
      const key = intentFingerprint(
        intentKey ? intentKey(variables) : variables
      )
      const intentId = unconfirmed.current.has(key)
        ? unconfirmed.current.get(key)
        : mintIntentId()
      calls.current.set(variables, { key, intentId })
      return mutationFn(variables, { intentId })
    },
    onSuccess: (data, variables) => {
      const call = calls.current.get(variables)
      calls.current.delete(variables)
      if (call) unconfirmed.current.delete(call.key)
      onSuccess?.(data, variables)
      if (typeof invalidate === "function") {
        invalidate()
      } else if (invalidate) {
        for (const queryKey of invalidate)
          void queryClient.invalidateQueries({ queryKey })
      }
      const copy =
        typeof successToast === "function"
          ? successToast(data, variables)
          : successToast
      if (copy) toasts.add(successToastFields(copy))
    },
    onError: (error, variables) => {
      const call = calls.current.get(variables)
      calls.current.delete(variables)
      // Two-person mode held the write for a second publisher: nothing
      // failed and nothing was sent, so it is not an error -- onError does
      // not run and it is not toasted as one -- and the approval panels
      // pick the new request up. Its intent is spent: the same form again
      // is a new request.
      if (isAwaitingApproval(error)) {
        if (call) unconfirmed.current.delete(call.key)
        onParked?.(variables)
        void queryClient.invalidateQueries({
          queryKey: queryKeys.listingChangeRequestsAll,
        })
        toasts.add({
          title: describeActionError(error),
          type: "info",
        })
        return
      }
      if (call) {
        if (isUnconfirmedFailure(error)) {
          unconfirmed.current.set(call.key, call.intentId)
        } else {
          unconfirmed.current.delete(call.key)
        }
      }
      const message = errorToast
        ? errorToast(error)
        : describeActionError(error, { context: errorContext })
      onError?.(error, message, variables)
      if (!quietError?.(error)) toasts.add({ title: message, type: "error" })
    },
  })
}
