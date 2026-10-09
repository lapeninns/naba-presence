"use client"

import { useEffect, type RefObject } from "react"

import { installReferenceReveals } from "@/lib/motion/reveal"

/**
 * Installs scroll reveals for every `[data-reveal]` under `ref` once the
 * subtree has mounted, and again whenever `key` changes (a new review in the
 * detail pane). Cleanup cancels only the animations this call created.
 */
export function useReveals(ref: RefObject<HTMLElement | null>, key?: string) {
  useEffect(() => {
    const root = ref.current
    if (!root) return
    return installReferenceReveals(root)
  }, [ref, key])
}
