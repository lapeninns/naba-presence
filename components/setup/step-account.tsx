"use client"

import { AccountPickerCard } from "@/components/settings/account-picker-card"

/**
 * Which Business Profile accounts belong to this client.
 *
 * Reuses the settings card rather than a second implementation: the selection
 * rules (auto-derived connection, explicit save) are the same job, and two
 * copies would drift the moment one gained a fix. The client and its login
 * scope the save, so choosing accounts here leaves other clients' accounts
 * alone.
 */
function StepAccount({
  clientId,
  connectionId,
}: {
  clientId: string
  connectionId: string | null
}) {
  return <AccountPickerCard clientId={clientId} connectionId={connectionId} />
}

export { StepAccount }
