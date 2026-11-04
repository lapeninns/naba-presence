"use client"

import { useState } from "react"

function focused() {
  if (typeof document === "undefined") return null
  const active = document.activeElement
  return active instanceof HTMLElement && active !== document.body
    ? active
    : null
}

function focusable(element: HTMLElement | null | undefined) {
  return element?.isConnected && !element.matches(":disabled") ? element : null
}

/**
 * The `finalFocus` for a sheet that opens from state rather than from a
 * trigger: the element that had focus when `open` turned true, or, when that
 * has gone (the sheet opened on load, or its opener re-mounted while a
 * preview loaded), `fallback`. With neither it leaves the dialog's default.
 *
 * The opener is read while rendering the change to `open`, before the dialog
 * mounts and takes focus.
 */
export function useOpenerFocus(
  open: boolean,
  fallback?: () => HTMLElement | null | undefined
): () => HTMLElement | true {
  const [wasOpen, setWasOpen] = useState(open)
  // A sheet loaded on demand mounts already open, with its opener focused.
  const [opener, setOpener] = useState(() => (open ? focused() : null))
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setOpener(focused())
  }
  return () => focusable(opener) ?? focusable(fallback?.()) ?? true
}
