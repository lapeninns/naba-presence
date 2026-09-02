"use client"

import { createContext, useContext, type ReactNode } from "react"

import { GateNote } from "@/components/locations/publish-gate"

/**
 * What every administration section needs from the tab shell. Provided once
 * by <AdministrationTab> (after the LocationTab gate passes) and read via
 * `useAdministrationSection()` at whatever depth a control lives — this
 * replaces the `locationId` / `disabled` / `publishReason` props that used to
 * be drilled five levels down to each button.
 */
export type AdministrationSectionContext = {
  locationId: string
  /** Display name for the danger-zone typed-name confirmation; "" until known. */
  locationName: string
  /** Canonical editing is blocked for this viewer (`editReason !== null`). */
  disabled: boolean
  /**
   * Why writes to Google are blocked, or null. Composed as
   * `editReason ?? resourceDisabledReason(...)`, so it is set whenever
   * `disabled` is.
   */
  publishReason: string | null
  /** `disabled || Boolean(publishReason)` — the shared "no writes" gate every action button uses. */
  writeBlocked: boolean
}

const Context = createContext<AdministrationSectionContext | null>(null)

export function AdministrationProvider({
  locationId,
  locationName,
  disabled,
  publishReason,
  children,
}: Omit<AdministrationSectionContext, "writeBlocked"> & {
  children: ReactNode
}) {
  return (
    <Context.Provider
      value={{
        locationId,
        locationName,
        disabled,
        publishReason,
        writeBlocked: disabled || Boolean(publishReason),
      }}
    >
      {children}
    </Context.Provider>
  )
}

export function useAdministrationSection(): AdministrationSectionContext {
  const value = useContext(Context)
  if (!value) {
    throw new Error(
      "useAdministrationSection must be rendered inside <AdministrationTab>"
    )
  }
  return value
}

/**
 * The per-action publish gate note. The tab-level GateNote already explains
 * the edit gate, so this one only speaks when editing is allowed but the
 * resource itself is blocked (paused / read-only / no publish permission).
 */
export function SectionGateNote() {
  const { disabled, publishReason } = useAdministrationSection()
  return <GateNote reason={disabled ? null : publishReason} />
}
