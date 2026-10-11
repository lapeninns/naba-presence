"use client"

import { createContext, useContext } from "react"

/**
 * Server-decided switches the settings pages share (env flags the client
 * cannot read). Provided once by the settings layout, so each page's
 * SettingsNav agrees on which tabs exist.
 */
export type SettingsFeatures = { mfa: boolean }

const SettingsFeaturesContext = createContext<SettingsFeatures>({ mfa: false })

export function SettingsFeaturesProvider({
  value,
  children,
}: {
  value: SettingsFeatures
  children: React.ReactNode
}) {
  return (
    <SettingsFeaturesContext.Provider value={value}>
      {children}
    </SettingsFeaturesContext.Provider>
  )
}

export function useSettingsFeatures(): SettingsFeatures {
  return useContext(SettingsFeaturesContext)
}
