"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationResult,
} from "@tanstack/react-query"

import { useToastManager } from "@/components/ui/toast"
// The ONE indirection for error copy. Sprint 4.4 merges the three action-errors
// modules into `@/lib/errors/action-errors`; when it lands, swap this import
// line and nothing else.
import { describeActionError as describeResourceError } from "@/lib/locations/action-errors"

export type ResourceMutationOptions<TData, TVariables> = {
  mutationFn: (variables: TVariables) => Promise<TData>
  /**
   * What to refresh after success: query keys from `queryKeys` (each is
   * invalidated, prefix-matched, fire-and-forget) or a custom function for
   * fan-out invalidations.
   */
  invalidate?: readonly QueryKey[] | (() => void)
  /** Success toast title. A function may return null to skip the toast. */
  successToast?:
    string | ((data: TData, variables: TVariables) => string | null)
  /**
   * Error copy source. Defaults to the shared `describeActionError`; override
   * per call site when a mutation needs bespoke copy. Its result is both
   * toasted and handed to `onError` as `message`.
   */
  errorToast?: (error: unknown) => string
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
    onSuccess,
    onError,
  } = options

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    onSuccess: (data, variables) => {
      onSuccess?.(data, variables)
      if (typeof invalidate === "function") {
        invalidate()
      } else if (invalidate) {
        for (const queryKey of invalidate)
          void queryClient.invalidateQueries({ queryKey })
      }
      const title =
        typeof successToast === "function"
          ? successToast(data, variables)
          : successToast
      if (title) toasts.add({ title, type: "success" })
    },
    onError: (error, variables) => {
      const message = (errorToast ?? describeResourceError)(error)
      onError?.(error, message, variables)
      toasts.add({ title: message, type: "error" })
    },
  })
}
