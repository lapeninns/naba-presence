"use client"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { Button } from "@/components/ui/button"

/**
 * Edits left behind by an earlier visit (kept in this tab through a forced
 * sign-out or an unmount nobody agreed to), offered back. `noun` names the
 * thing ("these hours", "this client's details").
 */
export function StashedEditsNotice({
  noun,
  onRestore,
  onDismiss,
}: {
  noun: string
  onRestore: () => void
  onDismiss: () => void
}) {
  return (
    <Alert variant="info" data-slot="draft-restore">
      <AlertTitle>You left unsaved edits to {noun}</AlertTitle>
      <AlertDescription>
        They were kept in this browser tab when you last left the page.
        Restore them to carry on, or dismiss them to start from what
        NabaPresence has saved.
      </AlertDescription>
      <AlertActions>
        {/* Secondary, not the green primary: restoring is a local
            step, and the accent is kept for the action that reaches
            Google. */}
        <Button size="sm" variant="secondary" onClick={onRestore}>
          Restore unsaved edits
        </Button>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </AlertActions>
    </Alert>
  )
}
