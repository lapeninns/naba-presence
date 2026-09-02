"use client"

import { GoogleDiff } from "@/components/locations/google-diff"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import type { GoogleDiffRow } from "@/lib/locations/google-values"

/** "Publish these … to Google?" with the field-by-field diff preview. */
export function PublishConfirmDialog({
  open,
  onOpenChange,
  title,
  rows,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  rows: GoogleDiffRow[]
  pending: boolean
  onConfirm: () => void
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>
          Review the changes before they replace what is on your Google Business
          Profile.
        </AlertDialogDescription>
        <GoogleDiff rows={rows} />
        <AlertDialogFooter>
          <AlertDialogClose
            render={<Button variant="outline">Cancel</Button>}
          />
          <Button onClick={onConfirm} disabled={pending}>
            {pending ? "Working…" : "Publish"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
