"use client"

import { useCallback, useEffect, useRef } from "react"

import { registerDraftSource, takeStashedDraft } from "@/lib/api/draft-stash"

// The one shared dirty guard (spec §6). Used by the reply composer now and the
// hours/menu/post editors later. Responsibilities:
//   1. Mirror the current content to the sessionStorage stash (via the
//      existing draft-stash registry) so a forced 401 sign-out preserves it.
//   2. Arm `beforeunload` while dirty so a tab close/reload warns.
//   3. Provide `confirmDiscard()` for in-app navigation / dialog dismissal.
//   4. Provide `restore()` to recover a stashed draft on mount.
//
// `askConfirm` is injected by the host (inbox DirtyGuardProvider's AlertDialog,
// or a test stub) so this hook stays UI-agnostic.
export function useDirtyGuard({
  key,
  isDirty,
  snapshot,
  askConfirm,
}: {
  key: string
  isDirty: boolean
  snapshot: () => string
  askConfirm?: () => Promise<boolean>
}): { confirmDiscard: () => Promise<boolean>; restore: () => string | null } {
  // Keep the latest dirtiness/snapshot in a ref so the registered source
  // function is stable but always reads current values. The write happens in
  // an effect (not during render) so refs are never mutated mid-render; every
  // consumer of `latest.current` below only runs from an event/effect, by
  // which point this effect has already committed the newest values.
  const latest = useRef({ isDirty, snapshot, askConfirm })
  useEffect(() => {
    latest.current = { isDirty, snapshot, askConfirm }
  })

  useEffect(() => {
    return registerDraftSource(key, () =>
      latest.current.isDirty ? latest.current.snapshot() : null
    )
  }, [key])

  useEffect(() => {
    if (!isDirty) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ""
    }
    window.addEventListener("beforeunload", handler)
    return () => window.removeEventListener("beforeunload", handler)
  }, [isDirty])

  const confirmDiscard = useCallback(async () => {
    if (!latest.current.isDirty) return true
    const ask = latest.current.askConfirm
    if (ask) return ask()
    return window.confirm(
      "You have unsaved changes to this reply. Discard them?"
    )
  }, [])

  const restore = useCallback(() => takeStashedDraft(key), [key])

  return { confirmDiscard, restore }
}
