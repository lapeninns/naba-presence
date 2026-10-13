"use client"

import { useState, type ReactNode } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { TypedConfirmation } from "@/components/ui/typed-confirmation"

// A destructive Google action (remove admin / transfer / delete location) needs
// TWO gates: the route's exact confirmation literal (sent by the client) AND this
// UI typed-name confirmation. The confirm button is inert until the typed name
// matches the location name (trimmed, case-insensitive). TypedConfirmation is
// the shared "type the name" field (label wired to the input, a polite
// "Matches" line); the button's own gate below stays this dialog's original
// comparison, so the guard is exactly as strict as it always was.
//
// Cancel comes first and the destructive action, which names the
// object, comes last so it sits at the trailing edge (and on top when the
// footer stacks on a phone).
export function DangerZoneDialog({
  open,
  onOpenChange,
  title,
  description,
  expectedName,
  confirmLabel,
  pending,
  onConfirm,
  consequences,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  expectedName: string
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
  /**
   * What happens once this goes through, one short sentence each, listed
   * before the typed name so the cost is read before it is confirmed.
   */
  consequences?: readonly ReactNode[]
}) {
  const [typed, setTyped] = useState("")
  // Defence-in-depth: an empty expectedName can never match, even against an
  // empty typed value — unreachable today because every call site disables
  // the dialog when locationName is empty, but this keeps the guard correct
  // in isolation.
  const matches =
    expectedName.trim().length > 0 &&
    typed.trim().toLowerCase() === expectedName.trim().toLowerCase()
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setTyped("")
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {consequences && consequences.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-caption font-medium text-ink-muted">
              What happens
            </p>
            <ul className="flex list-disc flex-col gap-1 ps-5 text-ui text-ink">
              {consequences.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <TypedConfirmation
          expected={expectedName}
          value={typed}
          onValueChange={setTyped}
          label="Type the location's name to confirm"
          placeholder={expectedName}
        />
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant="danger"
            onClick={onConfirm}
            disabled={!matches}
            pending={pending}
            pendingLabel="Working…"
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
