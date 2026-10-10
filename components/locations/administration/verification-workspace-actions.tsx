"use client"

import { createContext, useContext, useRef, useState, type ReactNode } from "react"

export type VerificationWorkflow = "start" | "complete"
type WorkspaceActions = {
  readonly active: VerificationWorkflow | null
  readonly busy: boolean
  readonly activate: (workflow: VerificationWorkflow) => void
  readonly claim: () => boolean
  readonly release: () => void
}
const Context = createContext<WorkspaceActions | null>(null)

/** Keep saved reviews mounted, but share one send surface and in-flight action. */
export function VerificationWorkspaceActions({ children }: { readonly children: ReactNode }) {
  const [active, setActive] = useState<VerificationWorkflow | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  return <Context.Provider value={{ active, busy,
    activate(workflow) { setActive(workflow) },
    claim() { if (inFlight.current) return false; inFlight.current = true; setBusy(true); return true },
    release() { inFlight.current = false; setBusy(false) },
  }}>{children}</Context.Provider>
}

export function useVerificationWorkspaceActions() { return useContext(Context) }
