"use client"

import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query"
import { useRef } from "react"

import { showToast } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import {
  markNotificationsRead,
  resolveNotification,
} from "@/lib/api/operational-notifications"
import { describeActionError } from "@/lib/errors/action-errors"
import {
  addPendingChange,
  commitPendingChange,
  isChangeLive,
  removePendingChange,
} from "@/lib/notifications/pending-changes"
import type { PendingChange } from "@/lib/notifications/pending-store"
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

/**
 * What a request reports: the rows the server saved, and null or why a later
 * turn was refused.
 */
type ChangeResult = {
  saved: readonly string[]
  failure: unknown
  /**
   * Rows in turns the server answered but did not fully save (it counts how
   * many it saved, not which): none of that turn is taken as saved, and the
   * person is told how many of the rows it answered for it saved.
   */
  short: { accepted: number; answered: number } | null
}

/**
 * Sends in turns of 100. A turn refused after an earlier one saved is not a
 * failure of the whole change: it reports what is left instead of throwing,
 * so what saved is kept and the list is refetched.
 */
async function send(
  client: QueryClient,
  change: PendingChange
): Promise<ChangeResult> {
  // Queued behind an earlier change, it may have been dropped meanwhile (the
  // session's scope moved on): nothing is sent for a change nobody can see,
  // and it ends as saved-nothing, which only removes it.
  if (!isChangeLive(client, change)) {
    return { saved: [], failure: null, short: null }
  }
  if (change.kind === "resolve") {
    await resolveNotification(change.ids[0]!)
    return { saved: change.ids, failure: null, short: null }
  }
  // The server counts an id once, however often it is sent, so a repeated id
  // would make a turn look short: each is sent once.
  const ids = [...new Set(change.ids)]
  const saved: string[] = []
  let accepted = 0
  let answered = 0
  let short = false
  const tally = () => (short ? { accepted, answered } : null)
  for (let from = 0; from < ids.length; from += READ_BATCH) {
    // Between turns the scope may have moved on: the rest is not sent.
    if (from > 0 && !isChangeLive(client, change)) {
      return { saved, failure: null, short: tally() }
    }
    const turn = ids.slice(from, from + READ_BATCH)
    let updated: number
    try {
      updated = (await markNotificationsRead(turn, change.read ?? true)).updated
    } catch (error) {
      if (from === 0) throw error
      return { saved, failure: error, short: tally() }
    }
    // The server drops ids it can no longer change (a row that became
    // invisible or was deleted) and answers with how many it saved, not which.
    // A turn that did not save every row is not taken as saved: nothing in it
    // is made permanent, and the refetch that follows shows what really is.
    answered += turn.length
    accepted += Math.min(turn.length, Math.max(0, updated))
    if (updated >= turn.length) saved.push(...turn)
    else short = true
  }
  return { saved, failure: null, short: tally() }
}

/** What a partly saved change says: how many of the rows answered for saved. */
function partialSave(
  verb: "read" | "unread",
  { accepted, answered }: { accepted: number; answered: number }
) {
  return {
    title:
      accepted === 0
        ? "Your change wasn’t saved"
        : `Some notifications weren’t marked as ${verb}`,
    description: `${accepted} of ${answered} saved. The list shows what is saved.`,
  }
}

/**
 * Why a resolve was refused, in words for this action: the shared wording
 * for these codes is about other screens ("This changed since you loaded
 * it" is untrue for a condition, which clears on its own). The role gate
 * answers `permission_denied`; the service's own check, `forbidden`.
 */
function resolveRefusal(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "permission_denied" || error.code === "forbidden")
      return "Only an owner or admin can resolve notifications. If your role just changed, reload the page."
    if (error.code === "notification_not_found")
      return "This notification no longer exists. The list is being refreshed."
    if (error.code === "notification_condition_active")
      return "This one can’t be resolved by hand. It clears on its own once the problem is fixed."
  }
  return describeActionError(error)
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
export function useNotificationChanges({
  onResolved,
}: {
  /**
   * A resolve the server confirmed, with the label it was sent with: only
   * for a change in the scope it was made in.
   */
  onResolved?: (label: string) => void
} = {}) {
  const client = useQueryClient()
  // What each resolve is called, by change id, so a refusal or a
  // confirmation can name it even once its row has left the list. Kept here
  // rather than on the pending change, which is shared with the shell.
  const labels = useRef(new Map<string, string>())
  const takeLabel = (change: PendingChange) => {
    const label = labels.current.get(change.id)
    labels.current.delete(change.id)
    return label
  }
  const mutation = useMutation<ChangeResult, unknown, PendingChange>({
    mutationKey: CHANGE_KEY,
    scope: CHANGE_SCOPE,
    mutationFn: (change) => send(client, change),
    onSuccess: async ({ saved, failure, short }, change) => {
      // A refetch or a shell poll that left before the answer may predate
      // the change; neither may land after the commit.
      await Promise.all([
        client.cancelQueries({ queryKey: queryKeys.notificationsAll }),
        client.cancelQueries({ queryKey: queryKeys.shellStatus }),
      ])
      // Cancelling does not stop a shell poll whose answer is already back and
      // only a few promise turns from seeding the badge (it seeds from inside
      // its own query function). Let those turns run first: that answer then
      // lands while this change is still pending, where it is judged against
      // the rows like any poll, and not after the commit as the server's word.
      await new Promise<void>((resolve) => setTimeout(resolve, 0))
      // What the server saved is made permanent (all of it, or the turns
      // that went before a refused one), so saved rows do not flash unread;
      // a change the store has dropped, or from another scope, is only removed.
      const live = isChangeLive(client, change)
      commitPendingChange(client, change, saved)
      void client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
      const label = takeLabel(change)
      if (live && change.kind === "resolve" && saved.length && label)
        onResolved?.(label)
      if (failure === null && short === null) return
      // Said only where the change was made: not in another scope.
      if (!live) return
      const verb = change.read === false ? "unread" : "read"
      showToast({
        id: "notifications-read-partial",
        type: "error",
        ...(failure === null && short
          ? partialSave(verb, short)
          : {
              title: `Some notifications weren’t marked as ${verb}`,
              description: describeActionError(failure),
            }),
      })
    },
    onError: (error, change) => {
      removePendingChange(client, change.id)
      void client.invalidateQueries({ queryKey: queryKeys.notificationsAll })
      const label = takeLabel(change)
      if (change.kind === "resolve") {
        // The title stays general; the description names the notification
        // first, since its row may be off screen on a long list.
        const reason = resolveRefusal(error)
        showToast({
          id: ERROR_TOAST_ID,
          type: "error",
          title: "The notification wasn’t resolved",
          description: label ? `${label}: ${reason}` : reason,
        })
        return
      }
      showToast({
        id: ERROR_TOAST_ID,
        type: "error",
        title: "Your change wasn’t saved",
        description: describeActionError(error),
      })
    },
  })
  return {
    /** Marks rows read (or unread), at once, then asks the server. */
    markRead: (ids: readonly string[], read: boolean) =>
      mutation.mutate(
        addPendingChange(client, { kind: "read", ids: [...new Set(ids)], read })
      ),
    /**
     * Resolves one notification, at once, then asks the server. The label
     * names it in what is said afterwards.
     */
    resolve: (id: string, label?: string) => {
      const change = addPendingChange(client, { kind: "resolve", ids: [id] })
      if (label) labels.current.set(change.id, label)
      mutation.mutate(change)
    },
  }
}
