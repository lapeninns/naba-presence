"use client"

import { useRef } from "react"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { useToastManager } from "@/components/ui/toast"

/**
 * "Discard your changes?" (reference discard dialog). Discarding only throws
 * away unsaved local edits; the sentence says so, because the one thing an
 * operator must not believe is that Google was touched.
 *
 * Confirming disables the Discard button that opened the dialog (nothing is
 * left to discard), so focus can't go back to it. It moves to the editor's
 * next enabled footer action instead, or to the page's `main`, and a toast
 * says what happened, rather than dropping focus on <body>.
 */
function DiscardDialog({
  open,
  onOpenChange,
  onConfirm,
  description = "Every field goes back to what NabaPresence last saved. Google is not affected.",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  description?: string
}) {
  const toasts = useToastManager()
  const confirmed = useRef(false)
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
        finalFocus={() => {
          if (!confirmed.current) return true
          confirmed.current = false
          return (
            document.querySelector<HTMLElement>(
              "[data-slot=editor-footer] button:not(:disabled)"
            ) ?? document.querySelector<HTMLElement>("main")
          )
        }}
      >
        <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>
            Keep editing
          </AlertDialogClose>
          <Button
            variant="danger-outline"
            onClick={() => {
              confirmed.current = true
              onConfirm()
              onOpenChange(false)
              toasts.add({
                title: "Changes discarded",
                description: "Back to what NabaPresence last saved.",
                type: "info",
              })
            }}
          >
            Discard changes
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export { DiscardDialog }
