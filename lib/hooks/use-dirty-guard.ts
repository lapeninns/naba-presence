"use client"

import { useCallback, useEffect, useRef } from "react"

import {
  draftsAbandoned,
  registerDraftSource,
  stashDraft,
  takeStashedDraft,
} from "@/lib/api/draft-stash"
import { draftKeyOwner } from "@/lib/editors/draft-key"

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
  stash = true,
}: {
  key: string
  isDirty: boolean
  snapshot: () => string
  askConfirm?: () => Promise<boolean>
  /** The `window.confirm` fallback's sentence, when no `askConfirm` is given. */
  confirmMessage?: string
  /**
   * Stash the edits on unmount and on a forced sign-out (responsibilities 1
   * and 5). Pass false for an editor that has no way to offer a stash back:
   * a stash nothing reads only lingers in sessionStorage.
   */
  stash?: boolean
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
  // Edits made under one signed-in identity whose key now names another
  // (another account signed in from a second tab and the session refetched
  // without a reload). They are never stashed or handed to the 401 stash
  // under the new identity, where its owner would be offered someone else's
  // text as their own. They stop being foreign once the content is clean
  // again (the editor reseeded or the operator discarded them).
  const foreign = useRef(false)
  // The signed-in identity the current content was written under.
  const owner = useRef<string | null>(null)
  useEffect(() => {
    latest.current = { isDirty, snapshot, askConfirm, confirmMessage }
    if (!isDirty) foreign.current = false
  })

  // Set once `confirmDiscard` resolves true, so the unmount that follows a
  // deliberate discard does not stash the very text the user just gave up.
  // Reset whenever the key changes, because a discard concerns one draft.
  const discarded = useRef(false)

  useEffect(() => {
    discarded.current = false
    const next = draftKeyOwner(key)
    if (latest.current.isDirty && owner.current !== null && next !== owner.current) {
      foreign.current = true
    }
    if (next !== null) owner.current = next
    if (!stash) return
    const unregister = registerDraftSource(key, () =>
      latest.current.isDirty && !foreign.current
        ? latest.current.snapshot()
        : null
    )
    return () => {
      unregister()
      if (latest.current.isDirty && !discarded.current && !foreign.current) {
        stashDraft(key, latest.current.snapshot())
      }
    }
  }, [key, stash])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      // Already agreed to lose these edits (the leave prompt): a full-page
      // navigation that follows must not ask a second time.
      if (discarded.current) return
      // The session these edits belonged to has ended (sign-out): leaving
      // is the only way forward, so don't offer "Stay".
      if (draftsAbandoned()) return
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
