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
  confirmVariant = "default",
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
  /** `danger` for a removal; the default accent for anything else. */
  confirmVariant?: "default" | "danger"
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
          <Checkbox
            checked={ack}
            onCheckedChange={(value) => setAck(value === true)}
            label={acknowledgementLabel}
            labelClassName="text-ui"
          />
        ) : null}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            variant={confirmVariant}
            onClick={onConfirm}
            disabled={requireAcknowledgement && !ack}
            pending={pending}
            pendingLabel="Sending to Google…"
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
