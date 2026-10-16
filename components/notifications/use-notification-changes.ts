"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"

import { showToast } from "@/components/ui/toast"
import {
  markNotificationsRead,
  resolveNotification,
} from "@/lib/api/operational-notifications"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  addPendingChange,
  commitPendingChange,
  currentScopeToken,
  removePendingChange,
  type PendingChange,
} from "@/lib/notifications/pending-changes"
import { queryKeys } from "@/lib/queries/keys"

/** The endpoint takes at most 100 ids at once; a long list is sent in turns. */
const READ_BATCH = 100

/**
 * Read and resolve share one mutation key and one queue, so they reach the
 * server in the order they were made. The pending changes themselves are
 * not in the cache (lib/notifications/pending-changes.ts): they are all
 * shown at once whatever is still queued.
 */
const CHANGE_KEY = ["notifications", "change"] as const
const CHANGE_SCOPE = { id: "notifications-change" }
const ERROR_TOAST_ID = "notifications-change-error"

/** What a request reports: null, or why a later turn was refused. */
type ChangeResult = { failure: unknown }

/**
 * Sends in turns of 100. A turn refused after an earlier one saved is not a
 * failure of the whole change: it reports what is left instead of throwing,
 * so the list is refetched and shows what the server holds.
 */
async function send(change: PendingChange): Promise<ChangeResult> {
  if (change.kind === "resolve") {
    await resolveNotification(change.ids[0]!)
    return { failure: null }
  }
  for (let from = 0; from < change.ids.length; from += READ_BATCH) {
    try {
      await markNotificationsRead(
        change.ids.slice(from, from + READ_BATCH),
        change.read ?? true
      )
    } catch (error) {
      if (from === 0) throw error
      return { failure: error }
    }
  }
  return { failure: null }
}

/**
 * Read and resolve for the notifications list. Each shows at once as a
 * pending change laid over the cached rows, never written into them, and
 * ends in one of three ways:
 *  - accepted: made permanent in the cached lists and the shell badge in the
 *    same step as it stops being pending, then the lists are refetched;
 *  - refused: only that change is taken back, with an error toast;
 *  - the session's scope moved on meanwhile: the change is dropped without
 *    touching the cache, so another scope's rows are never put back.
 */
export function useNotificationChanges() {
  const client = useQueryClient()
  const mutation = useMutation<ChangeResult, unknown, PendingChange>({
    mutationKey: CHANGE_KEY,
    scope: CHANGE_SCOPE,
    mutationFn: send,
    onSuccess: async ({ failure }, change) => {
      const reconcile = () =>
        void client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
      if (failure !== null) {
        // Part saved and a later turn was refused: what is known is only what
        // the server holds, so there is nothing to commit.
        removePendingChange(client, change.id)
        reconcile()
        showToast({
          id: "notifications-read-partial",
          type: "error",
          title: "Some notifications weren’t marked as read",
          description: describeActionError(failure),
        })
        return
      }
      // A refetch started before the answer may predate the change.
      await client.cancelQueries({ queryKey: queryKeys.notificationsAll })
      if (currentScopeToken(client) === change.scope)
        commitPendingChange(client, change)
      else removePendingChange(client, change.id)
      reconcile()
    },
    onError: (error, change) => {
      removePendingChange(client, change.id)
      void client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
      showToast({
        id: ERROR_TOAST_ID,
        type: "error",
        title:
          change.kind === "resolve"
            ? "The notification wasn’t resolved"
            : "Your change wasn’t saved",
        description: describeActionError(error),
      })
    },
  })
  return {
    /** Marks rows read (or unread), at once, then asks the server. */
    markRead: (ids: readonly string[], read: boolean) =>
      mutation.mutate(addPendingChange(client, { kind: "read", ids, read })),
    /** Resolves one notification, at once, then asks the server. */
    resolve: (id: string) =>
      mutation.mutate(addPendingChange(client, { kind: "resolve", ids: [id] })),
  }
}
