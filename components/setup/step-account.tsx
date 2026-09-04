"use client"

import { AccountPickerCard } from "@/components/settings/account-picker-card"

/**
 * Which Business Profile accounts belong to this client.
 *
 * Reuses the settings card rather than a second implementation: the selection
 * rules (auto-derived connection, explicit save) are the same job, and two
 * copies would drift the moment one gained a fix.
 */
function StepAccount() {
  return <AccountPickerCard />
}

export { StepAccount }
