"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { LeavePrompt } from "./use-leave-guard"

/**
 * Ask before closing a sheet or dialog throws its unsaved edits away.
 *
 * Wraps the overlay's `onOpenChange`: opening, and closing while clean, pass
 * straight through. Closing while dirty (Escape, the close button, a click
 * outside, a Cancel button that calls `requestClose`) keeps the overlay open
 * and opens the prompt instead. Confirming calls `onDiscard` (the editor
 * throws its edits away, so they are neither kept nor stashed) and then
 * closes; "Keep editing" leaves everything as it was.
 *
 * Spread `prompt` into a `<DiscardDialog />` rendered beside the overlay.
 */
export function useCloseGuard({
  isDirty,
  onOpenChange,
  onDiscard,
}: {
  isDirty: boolean
  onOpenChange: (open: boolean) => void
  onDiscard?: () => void
}): {
  onOpenChange: (open: boolean) => void
  /** Close as if the overlay's own close control was used. */
  requestClose: () => void
  prompt: LeavePrompt
} {
  const [asking, setAsking] = useState(false)
  const latest = useRef({ isDirty, onOpenChange, onDiscard })
  useEffect(() => {
    latest.current = { isDirty, onOpenChange, onDiscard }
  })

  const guarded = useCallback((open: boolean) => {
    if (!open && latest.current.isDirty) {
      setAsking(true)
      return
    }
    latest.current.onOpenChange(open)
  }, [])
  const requestClose = useCallback(() => guarded(false), [guarded])

  const promptOpenChange = useCallback((open: boolean) => {
    if (!open) setAsking(false)
  }, [])
  const onConfirm = useCallback(() => {
    setAsking(false)
    latest.current.onDiscard?.()
    latest.current.onOpenChange(false)
  }, [])

  return {
    onOpenChange: guarded,
    requestClose,
    prompt: { open: asking, onOpenChange: promptOpenChange, onConfirm },
  }
}
