"use client"

import { useState } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"

export function OverwriteConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  requireAcknowledgement,
  acknowledgementLabel,
  pending,
  onConfirm,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  requireAcknowledgement: boolean
  acknowledgementLabel?: string
  pending: boolean
  onConfirm: () => void
  /** Optional preview content rendered between the description and controls. */
  children?: React.ReactNode
}) {
  const [ack, setAck] = useState(false)
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) setAck(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        {children}
        {requireAcknowledgement ? (
          <label className="flex items-start gap-2 text-ui">
            {/* Base UI's Checkbox auto-wires aria-labelledby to a wrapping
                native <label> — no separate aria-label needed here (mirrors
                typed-attribute-control.tsx). */}
            <Checkbox checked={ack} onCheckedChange={(value) => setAck(value === true)} />
            <span>{acknowledgementLabel}</span>
          </label>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline">Cancel</Button>} />
          <Button onClick={onConfirm} disabled={pending || (requireAcknowledgement && !ack)}>
            {pending ? "Working…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
