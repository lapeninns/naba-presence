"use client"

import {
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query"
import type * as React from "react"

import { showToast } from "@/components/ui/toast"

/** What `onMutate` hands to `onError`: the cache as it was, to put back. */
type OptimisticContext<TCache> = {
  queryKey: QueryKey
  previous: TCache | undefined
}

export type UseOptimisticMutationOptions<
  TData,
  TVariables,
  TCache,
  TError = Error,
> = Omit<
  UseMutationOptions<TData, TError, TVariables, OptimisticContext<TCache>>,
  "onMutate" | "onError" | "onSettled"
> & {
  /** The cached query the change is shown in; may depend on the variables. */
  queryKey: QueryKey | ((variables: TVariables) => QueryKey)
  /**
   * The cache as it will look once the change succeeds. Pure: return a new
   * value, never mutate `current`. `current` is undefined when nothing is
   * cached yet; return undefined to leave the cache alone.
   */
  update: (
    current: TCache | undefined,
    variables: TVariables
  ) => TCache | undefined
  /** The error toast's words: what failed, in plain English. */
  errorTitle: React.ReactNode | ((error: TError) => React.ReactNode)
  errorDescription?: React.ReactNode | ((error: TError) => React.ReactNode)
  /**
   * Further queries to refetch when the mutation settles; the changed query
   * (`queryKey`) is always refetched. Pass keys the change also affects
   * (counts, a detail view).
   */
  alsoInvalidate?: QueryKey[]
  /**
   * A stable id for the error toast, so a second failure replaces the first
   * rather than stacking. Defaults to one id per mutation.
   */
  errorToastId?: string
}

/**
 * The optimistic update recipe for TanStack Query: the screen changes the
 * moment the operator acts, and puts itself right if the server says no.
 * For a LOCAL change the server will almost always accept (mark read, tick a
 * preference). A Google write is never optimistic: use `toastProgress` with
 * `kind: "google"` and show the result when it arrives.
 *
 *   const markRead = useOptimisticMutation({
 *     mutationFn: (id: string) => markNotificationRead(id),
 *     queryKey: queryKeys.notifications,
 *     update: (current, id) =>
 *       current && {
 *         ...current,
 *         items: current.items.map((item) =>
 *           item.id === id ? { ...item, read: true } : item
 *         ),
 *       },
 *     errorTitle: "Could not mark as read",
 *   })
 *
 * What it does, in order:
 * 1. `onMutate`: cancels in-flight fetches of the query (so a slow refetch
 *    cannot overwrite the change), snapshots the cache, then applies `update`.
 * 2. `onError`: puts the snapshot back and shows an error toast
 *    (`errorTitle`), so the failure is seen even if the operator has moved on.
 * 3. `onSettled`: refetches the query (and `alsoInvalidate`), so the screen
 *    ends on what the server holds whether it succeeded or failed.
 *
 * Caveats: two overlapping mutations on one query roll back to their own
 * snapshot, and the refetch on settle then corrects any difference. Keep
 * `update` to the one query; list derivations belong in `alsoInvalidate`.
 * `onSuccess` and the other mutation options pass straight through.
 */
export function useOptimisticMutation<
  TData = unknown,
  TVariables = void,
  TCache = unknown,
  TError = Error,
>({
  queryKey,
  update,
  errorTitle,
  errorDescription,
  alsoInvalidate,
  errorToastId,
  mutationKey,
  ...options
}: UseOptimisticMutationOptions<TData, TVariables, TCache, TError>) {
  const client = useQueryClient()
  const keyFor = (variables: TVariables) =>
    typeof queryKey === "function" ? queryKey(variables) : queryKey
  const toastId =
    errorToastId ??
    `optimistic-error:${mutationKey ? JSON.stringify(mutationKey) : "mutation"}`

  return useMutation<TData, TError, TVariables, OptimisticContext<TCache>>({
    ...options,
    mutationKey,
    onMutate: async (variables) => {
      const key = keyFor(variables)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<TCache>(key)
      const next = update(previous, variables)
      if (next !== undefined) client.setQueryData<TCache>(key, next)
      return { queryKey: key, previous }
    },
    onError: (error, _variables, context) => {
      if (context) {
        client.setQueryData<TCache | undefined>(
          context.queryKey,
          context.previous
        )
      }
      showToast({
        id: toastId,
        type: "error",
        title:
          typeof errorTitle === "function" ? errorTitle(error) : errorTitle,
        description:
          typeof errorDescription === "function"
            ? errorDescription(error)
            : errorDescription,
      })
    },
    onSettled: async (_data, _error, variables) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: keyFor(variables) }),
        ...(alsoInvalidate ?? []).map((key) =>
          client.invalidateQueries({ queryKey: key })
        ),
      ])
    },
  })
}
