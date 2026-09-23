"use client"

import { InfoIcon } from "lucide-react"

import { AccountPickerCard } from "@/components/settings/account-picker-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

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
  clientName,
  clientId,
  connectionId,
}: {
  clientName: string
  clientId: string
  connectionId: string | null
}) {
  return (
    <>
      <Alert variant="info" icon={<InfoIcon aria-hidden />}>
        <AlertTitle>One Google login can manage many accounts</AlertTitle>
        <AlertDescription>
          Tick only the ones that belong to {clientName}, then save. The rest
          stay available for other clients.
        </AlertDescription>
      </Alert>
      <AccountPickerCard clientId={clientId} connectionId={connectionId} />
    </>
  )
}

export { StepAccount }
