"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query"

import { useToastManager } from "@/components/ui/toast"
import { mintIntentId } from "@/lib/api/client"
import {
  successToastFields,
  type SuccessToastCopy,
} from "@/lib/editors/outcome"
import {
  describeActionError,
  type ActionErrorContext,
} from "@/lib/errors/action-errors"

/** Handed to `mutationFn` with every call. */
export type MutationIntent = {
  /**
   * One id per `mutate` call, for `apiFetch`'s `intentId` option: resent on
   * a retry of this same action, the server answers the retry from its
   * receipt rather than writing twice. No lib/api wrapper forwards it yet
   * (docs/architecture.md, "Operation receipts"), so today each call still
   * sends a fresh intent. Undefined where the browser offers no UUIDs.
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
   * Surface handed to `describeActionError` for the two approval codes whose
   * copy differs between review replies and Google posts. Ignored when
   * `errorToast` is set.
   */
  errorContext?: ActionErrorContext
  /** Extra success work (reset local state, close a dialog). Runs before invalidation. */
  onSuccess?: (data: TData, variables: TVariables) => void
  /** Extra error work; `message` is the already-humanised copy. Runs before the toast. */
  onError?: (error: unknown, message: string, variables: TVariables) => void
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
    errorContext,
    onSuccess,
    onError,
  } = options

  return useMutation<TData, Error, TVariables>({
    // One intent per call. Mutations run without TanStack retries here, so
    // a call is one user action; a caller that retries the SAME action
    // itself keeps the intent it was handed and resends it.
    mutationFn: (variables: TVariables) =>
      mutationFn(variables, { intentId: mintIntentId() }),
    onSuccess: (data, variables) => {
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
      const message = errorToast
        ? errorToast(error)
        : describeActionError(error, { context: errorContext })
      onError?.(error, message, variables)
      toasts.add({ title: message, type: "error" })
    },
  })
}
