"use client"

import * as React from "react"

/**
 * Whether this deployment shows the Billing and Usage settings screens
 * (plan P07-S6). The settings layout provides it from BILLING_ENABLED, the
 * same switch that gates every billing route, so with billing off Settings
 * looks exactly as before. Default off.
 */
const BillingScreensContext = React.createContext(false)

export function BillingScreensProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: React.ReactNode
}) {
  return (
    <BillingScreensContext.Provider value={enabled}>
      {children}
    </BillingScreensContext.Provider>
  )
}

export function useBillingScreensEnabled(): boolean {
  return React.useContext(BillingScreensContext)
}
