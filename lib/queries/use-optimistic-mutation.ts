"use client"

import {
  hashKey,
  useMutation,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query"
import * as React from "react"

import { showToast } from "@/components/ui/toast"

/** What `onMutate` hands to `onError`: the cache as it was, to put back. */
type OptimisticContext<TCache> = {
  queryKey: QueryKey
  previous: TCache | undefined
  /** Whether `update` changed the cache (it may decline by returning undefined). */
  applied: boolean
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
   * rather than stacking. Defaults to one id per `mutationKey`, so two
   * different mutations never share a toast.
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
 *   type Notifications = { items: { id: string; read: boolean }[] }
 *
 *   const markRead = useOptimisticMutation<void, string, Notifications>({
 *     mutationFn: (id) => markNotificationRead(id),
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
 * The generics are `<TData, TVariables, TCache>`: name them, as above, so
 * `current` and the returned value are typed.
 *
 * What it does, in order:
 * 1. `onMutate`: cancels in-flight fetches of the query (so a slow refetch
 *    cannot overwrite the change), snapshots the cache, then applies `update`.
 * 2. `onError`: puts the snapshot back and shows an error toast
 *    (`errorTitle`), so the failure is seen even if the operator has moved on.
 *    If the cache was empty and `update` created the data, the entry is reset
 *    rather than set to undefined.
 * 3. `onSettled`: refetches the query (and `alsoInvalidate`), so the screen
 *    ends on what the server holds whether it succeeded or failed.
 *
 * Overlapping calls (a second tap while the first is in flight) share one
 * `mutationKey` (by default `["optimistic", ...queryKey]`). While another call on the same query is still pending, a
 * settling call neither restores its snapshot (it predates the other's
 * change) nor refetches (the answer would not yet include the other's
 * change). The last call to settle refetches once, which corrects whatever
 * the earlier ones left. Keep `update` to the one query; list derivations
 * belong in `alsoInvalidate`. `onSuccess` and the other mutation options
 * pass straight through.
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
  const instanceId = React.useId()
  const keyFor = (variables: TVariables) =>
    typeof queryKey === "function" ? queryKey(variables) : queryKey
  const resolvedMutationKey: QueryKey =
    mutationKey ??
    (typeof queryKey === "function"
      ? ["optimistic", instanceId]
      : ["optimistic", ...queryKey])
  const toastId =
    errorToastId ?? `optimistic-error:${hashKey(resolvedMutationKey)}`

  /** How many calls on this query are still pending (this one included). */
  const pendingOn = (key: QueryKey) =>
    client.getMutationCache().findAll({
      mutationKey: resolvedMutationKey,
      predicate: (mutation) =>
        mutation.state.status === "pending" &&
        hashKey(keyFor(mutation.state.variables as TVariables)) ===
          hashKey(key),
    }).length

  return useMutation<TData, TError, TVariables, OptimisticContext<TCache>>({
    ...options,
    mutationKey: resolvedMutationKey,
    onMutate: async (variables) => {
      const key = keyFor(variables)
      await client.cancelQueries({ queryKey: key })
      const previous = client.getQueryData<TCache>(key)
      const next = update(previous, variables)
      const applied = next !== undefined
      if (applied) client.setQueryData<TCache>(key, next)
      return { queryKey: key, previous, applied }
    },
    onError: (error, _variables, context) => {
      // Another call is still pending: this snapshot predates its change, so
      // restoring it would undo that. The last call to settle refetches.
      if (context?.applied && pendingOn(context.queryKey) <= 1) {
        if (context.previous === undefined) {
          // `update` made data out of nothing: there is no snapshot to put
          // back, and setQueryData(undefined) would leave it in place.
          void client.resetQueries({ queryKey: context.queryKey, exact: true })
        } else {
          client.setQueryData<TCache>(context.queryKey, context.previous)
        }
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
      const key = keyFor(variables)
      if (pendingOn(key) > 1) return
      await Promise.all([
        client.invalidateQueries({ queryKey: key }),
        ...(alsoInvalidate ?? []).map((other) =>
          client.invalidateQueries({ queryKey: other })
        ),
      ])
    },
  })
}
