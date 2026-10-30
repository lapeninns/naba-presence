"use client"

import { useState } from "react"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { OverlayCancel } from "@/components/ui/overlay"
import { Textarea } from "@/components/ui/textarea"
import { useToastManager } from "@/components/ui/toast"
import { describeActionError } from "@/lib/errors/action-errors"
import type {
  CompletenessCheck,
  CompletenessCheckId,
} from "@/lib/listings/completeness"
import { completenessSkipInputSchema } from "@/lib/listings/completeness-contract"
import { useCompletenessSkipMutations } from "@/lib/queries/use-listing-completeness"

/**
 * A reason that fits the check, as a hint under the field. Checks without
 * an obvious one get no example rather than one that reads oddly.
 */
const REASON_EXAMPLES: Partial<Record<CompletenessCheckId, string>> = {
  booking_link: "We take walk-ins only.",
  services_or_menu: "We don’t serve food.",
  special_hours: "We keep our usual hours on bank holidays.",
  logo_photo: "We don’t have a logo.",
  recent_post: "We’re closed for refurbishment until spring.",
  recent_photo: "We’re closed for refurbishment until spring.",
}

function reasonHint(check: CompletenessCheck | null): string | null {
  if (!check) return null
  if (check.importance === "necessary")
    return "This is an essential check: customers rely on it. Skip it only if it truly doesn’t apply."
  const example = REASON_EXAMPLES[check.id]
  return example ? `For example: “${example}”` : null
}

/**
 * Stop one completeness check counting for a listing, with the reason an
 * owner or admin gives ("We take walk-ins only" for a booking link). The reason is shown to
 * everyone who opens the listing, and the skip is audited.
 */
function CompletenessSkipDialog({
  locationId,
  check,
  onOpenChange,
  finalFocus,
}: {
  locationId: string
  /** The check to skip; the dialog is open while one is set. */
  check: CompletenessCheck | null
  onOpenChange: (open: boolean) => void
  /** Where focus goes when the dialog closes, if not its trigger. */
  finalFocus?: React.ComponentProps<typeof DialogContent>["finalFocus"]
}) {
  const toast = useToastManager()
  const { skip } = useCompletenessSkipMutations(locationId)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | undefined>()
  const [formError, setFormError] = useState<string | null>(null)
  // The last check shown, so the title doesn't empty while the dialog
  // animates closed. Adjusted during render, not in an effect.
  const [shown, setShown] = useState(check)
  if (check && check !== shown) setShown(check)
  const hint = reasonHint(shown)

  const reset = () => {
    setReason("")
    setError(undefined)
    setFormError(null)
  }

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    if (!check) return
    setFormError(null)
    const parsed = completenessSkipInputSchema.safeParse({
      checkId: check.id,
      reason,
    })
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    setError(undefined)
    skip.mutate(parsed.data, {
      onSuccess: () => {
        toast.add({
          title: "Check skipped",
          description: `“${check.title}” no longer counts towards the score.`,
          type: "success",
        })
        reset()
        onOpenChange(false)
      },
      onError: (failure) => setFormError(describeActionError(failure)),
    })
  }

  return (
    <Dialog
      open={check !== null}
      dirty={reason.trim() !== "" && !skip.isPending}
      onDiscard={reset}
      discardPrompt={{
        title: "Discard this reason?",
        description: "The check keeps counting, and the reason is lost.",
      }}
      onOpenChange={(next) => {
        if (!next) {
          if (skip.isPending) return
          reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent
        className="grid-cols-[minmax(0,1fr)]"
        finalFocus={finalFocus}
        // A Cancel in the footer instead of the ✕: the way out sits by the
        // confirm, and a typed reason still asks before it's lost.
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Skip “{shown?.title}”?</DialogTitle>
          <DialogDescription>
            It won’t count towards this listing’s score. Everyone who can see
            the listing sees your reason, and an owner or admin can count it
            again at any time.
          </DialogDescription>
        </DialogHeader>
        <form noValidate onSubmit={onSubmit} className="contents">
          <DialogBody>
            <Field error={error}>
              <FieldLabel>Why doesn’t this apply?</FieldLabel>
              <Textarea
                autoSize
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value)
                  if (error) setError(undefined)
                }}
              />
              {hint ? <FieldDescription>{hint}</FieldDescription> : null}
              <FieldError>{error}</FieldError>
            </Field>
            {formError ? (
              <Alert variant="destructive">
                <AlertTitle>The check wasn’t skipped</AlertTitle>
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <OverlayCancel disabled={skip.isPending} />
            <Button
              type="submit"
              pending={skip.isPending}
              pendingLabel="Skipping…"
            >
              Skip check
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { CompletenessSkipDialog }
