"use client"

import { useState } from "react"

import { AlertDialog, AlertDialogClose, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

// A destructive Google action (remove admin / transfer / delete location) needs
// TWO gates: the route's exact confirmation literal (sent by the client) AND this
// UI typed-name confirmation. The confirm button is inert until the typed name
// matches the location name (trimmed, case-insensitive). The Field/FieldLabel
// pair wires the Input's id to the label's htmlFor automatically (see
// components/ui/input.tsx's useFieldContext), so no separate aria-label is
// needed on the Input itself.
export function DangerZoneDialog({
  open, onOpenChange, title, description, expectedName, confirmLabel, pending, onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  expectedName: string
  confirmLabel: string
  pending: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState("")
  const matches = typed.trim().toLowerCase() === expectedName.trim().toLowerCase()
  return (
    <AlertDialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setTyped("") }}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <Field>
          <FieldLabel>Type the location&apos;s name to confirm</FieldLabel>
          <Input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder={expectedName} autoComplete="off" />
        </Field>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button variant="destructive" onClick={onConfirm} disabled={!matches || pending}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
