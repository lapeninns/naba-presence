"use client"

import { useCallback, useEffect, useRef } from "react"

import {
  registerDraftSource,
  stashDraft,
  takeStashedDraft,
} from "@/lib/api/draft-stash"

// The one shared dirty guard (spec §6). Used by the reply composer now and the
// hours/menu/post editors later. Responsibilities:
//   1. Mirror the current content to the sessionStorage stash (via the
//      existing draft-stash registry) so a forced 401 sign-out preserves it.
//   2. Arm `beforeunload` while dirty so a tab close/reload warns.
//   3. Provide `confirmDiscard()` for in-app navigation / dialog dismissal.
//   4. Provide `restore()` to recover a stashed draft on mount.
//   5. Stash the content when a dirty editor unmounts without the user having
//      chosen to discard — the inbox moves the composer between the split
//      pane and the bottom sheet when the viewport crosses its breakpoint,
//      and a remount would otherwise reseed from the server and lose the
//      reply silently.
//
// `askConfirm` is injected by the host (inbox DirtyGuardProvider's AlertDialog,
// the listing editors' DiscardDialog, or a test stub) so this hook stays
// UI-agnostic. Without one it falls back to `window.confirm(confirmMessage)`.
//
// In-app link clicks are guarded separately by `useLeaveGuard`
// (lib/editors/use-leave-guard.ts), which calls `markDiscarded` once the
// operator agrees to leave so the unmount that follows doesn't stash the
// edits they just gave up.
const DEFAULT_CONFIRM_MESSAGE = "You have unsaved changes. Discard them?"

export function useDirtyGuard({
  key,
  isDirty,
  snapshot,
  askConfirm,
  confirmMessage = DEFAULT_CONFIRM_MESSAGE,
}: {
  key: string
  isDirty: boolean
  snapshot: () => string
  askConfirm?: () => Promise<boolean>
  /** The `window.confirm` fallback's sentence, when no `askConfirm` is given. */
  confirmMessage?: string
}): {
  confirmDiscard: () => Promise<boolean>
  restore: () => string | null
  /** The operator chose to lose these edits: don't stash them on unmount. */
  markDiscarded: () => void
} {
  // Keep the latest dirtiness/snapshot in a ref so the registered source
  // function is stable but always reads current values. The write happens in
  // an effect (not during render) so refs are never mutated mid-render; every
  // consumer of `latest.current` below only runs from an event/effect, by
  // which point this effect has already committed the newest values.
  const latest = useRef({ isDirty, snapshot, askConfirm, confirmMessage })
  useEffect(() => {
    latest.current = { isDirty, snapshot, askConfirm, confirmMessage }
  })

  // Set once `confirmDiscard` resolves true, so the unmount that follows a
  // deliberate discard does not stash the very text the user just gave up.
  // Reset whenever the key changes, because a discard concerns one draft.
  const discarded = useRef(false)

  useEffect(() => {
    discarded.current = false
    const unregister = registerDraftSource(key, () =>
      latest.current.isDirty ? latest.current.snapshot() : null
    )
    return () => {
      unregister()
      if (latest.current.isDirty && !discarded.current) {
        stashDraft(key, latest.current.snapshot())
      }
    }
  }, [key])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      // Already agreed to lose these edits (the leave prompt): a full-page
      // navigation that follows must not ask a second time.
      if (discarded.current) return
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const confirmDiscard = useCallback(async () => {
    if (!latest.current.isDirty) return true
    const ask = latest.current.askConfirm
    const result = ask
      ? await ask()
      : window.confirm(latest.current.confirmMessage)
    if (result) discarded.current = true
    return result
  }, [])

  const restore = useCallback(() => takeStashedDraft(key), [key])

  const markDiscarded = useCallback(() => {
    discarded.current = true
  }, [])

  return { confirmDiscard, restore, markDiscarded }
}
