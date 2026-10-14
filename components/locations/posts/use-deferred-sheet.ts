"use client"

import { useCallback, useRef, useState } from "react"

type Handle = { open: () => void }

/**
 * A sheet that draws no trigger of its own (it hands back `open()` through
 * `openRef`), mounted only once something asks to open it: every post row
 * offers one, and few are ever opened. `open()` before the sheet has
 * mounted mounts it, and it opens as soon as its handle arrives. From then
 * on it stays mounted, keeping its state like an eagerly mounted sheet.
 */
export function useDeferredSheet() {
  const [mounted, setMounted] = useState(false)
  const handle = useRef<Handle | null>(null)
  const pending = useRef(false)
  const openRef = useCallback((next: Handle | null) => {
    handle.current = next
    if (next && pending.current) {
      pending.current = false
      next.open()
    }
  }, [])
  const open = useCallback(() => {
    if (handle.current) {
      handle.current.open()
      return
    }
    pending.current = true
    setMounted(true)
  }, [])
  return { mounted, openRef, open }
}
