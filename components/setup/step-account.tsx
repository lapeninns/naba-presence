"use client"

import { AccountPickerCard } from "@/components/settings/account-picker-card"

/**
 * Which Business Profile accounts belong to this client.
 *
 * Reuses the settings card rather than a second implementation: the selection
 * rules (auto-derived connection, explicit save) are the same job, and two
 * copies would drift the moment one gained a fix. The client and its login
 * scope the save, so choosing accounts here leaves other clients' accounts
 * alone. The step description already says why to tick only some, so the
 * list starts right under the title.
 *
 * `onChooseAnotherLogin` is the way back to Connect when this login has no
 * accounts, so the step's blocker can be cleared from the screen that raises
 * it.
 */
function StepAccount({
  clientId,
  connectionId,
  saveBeforeContinueRef,
  onChooseAnotherLogin,
}: {
  clientId: string
  connectionId: string | null
  saveBeforeContinueRef: React.RefObject<(() => Promise<boolean>) | null>
  onChooseAnotherLogin?: () => void
}) {
  return (
    <AccountPickerCard
      clientId={clientId}
      connectionId={connectionId}
      saveBeforeContinueRef={saveBeforeContinueRef}
      onChooseAnotherLogin={onChooseAnotherLogin}
    />
  )
}

export { StepAccount }
