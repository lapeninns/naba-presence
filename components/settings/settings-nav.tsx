import type * as React from "react"

/**
 * Draws nothing: the settings layout's section list
 * (components/settings/settings-section-list.tsx) replaced this tab row.
 * Settings pages still pass it as their header's `tabs` until each drops it.
 */
export const SettingsNav: React.FC<{
  role: string | null
  className?: string
}> = () => null
