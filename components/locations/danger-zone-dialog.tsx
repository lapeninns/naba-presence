"use client"

import { CheckIcon } from "lucide-react"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

// A destructive Google action (remove admin / transfer / delete location) needs
// TWO gates: the route's exact confirmation literal (sent by the client) AND this
// UI typed-name confirmation. The confirm button is inert until the typed name
// matches the location name (trimmed, case-insensitive). The field mirrors the
// shared TypedConfirmation (label wired to the input, a polite "Matches"
// line), but both that line and the button read the one `matches` below: the
// primitive's modes either collapse inner spaces or compare case, and neither
// is this dialog's original comparison, which stays exactly as strict.
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
        <Field>
          <FieldLabel>Type the location&apos;s name to confirm</FieldLabel>
          <Input
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="done"
            data-matched={matches || undefined}
            placeholder={expectedName}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          {/* Always mounted so the live region exists before its first
              message; screen readers skip announcements into a fresh region. */}
          <p
            aria-live="polite"
            data-slot="typed-confirmation-status"
            className={cn(
              "flex min-h-4 items-center gap-1.5 text-caption font-medium text-ink-muted",
              matches && "text-success-ink"
            )}
          >
            {matches ? (
              <>
                <CheckIcon aria-hidden strokeWidth={2} className="size-3.5" />
                Matches
              </>
            ) : null}
          </p>
        </Field>
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
