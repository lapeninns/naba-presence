"use client"

import * as React from "react"

import { ChangeDiff, type ChangeRow } from "@/components/editors/change-diff"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  PublishSteps,
  type PublishStep as PublishStepView,
} from "@/components/ui/publish-steps"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { PublishStepResult } from "@/lib/editors/use-publish-flow"

/**
 * The confirmation step in front of every Google write (reference review
 * sheet): the field-level diff, an explicit overwrite acknowledgement when
 * Google changed something since the draft started, then the per-step
 * results of the publish as the real responses arrive.
 *
 * One sheet, not three different confirmations: an operator publishing to a
 * client's public listing sees the same thing every time, and that thing is
 * the actual diff rather than a sentence claiming there is one.
 *
 * Step wording follows what the app can prove. A step that saved
 * NabaPresence's copy says "Saved here"; a Google write whose request
 * succeeded says "Sent to Google", never "Live on Google", because the app
 * has no verification evidence at that moment. The editor's own status
 * (refetched afterwards) is what says the listing matches Google.
 */
function ReviewChangesSheet({
  open,
  onOpenChange,
  rows,
  locationName,
  onPublish,
  onSaveDraft,
  publishing,
  results,
  error,
  publishDisabledReason,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rows: ChangeRow[]
  locationName: string
  onPublish: () => void | Promise<void>
  /**
   * Present only for resources that keep a copy of their own. Publishing is
   * the point of the sheet; saving without publishing is the exception.
   */
  onSaveDraft?: () => void | Promise<void>
  publishing?: boolean
  /** Per-step outcome, so a half-finished publish is visible rather than guessed. */
  results?: PublishStepResult[]
  error?: string | null
  /** Why publishing can't run right now (paused, no permission). */
  publishDisabledReason?: string | null
}) {
  const conflicts = rows.filter((row) => row.state === "conflict")
  const [acknowledged, setAcknowledged] = React.useState(false)
  // A fresh sheet asks again. Carrying the tick over from a previous review
  // would let an operator publish an overwrite they never actually saw. The
  // reset happens during render (React's documented "adjust state when a prop
  // changes" pattern) so the checkbox is never briefly ticked after opening.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAcknowledged(false)
  }

  const blocked =
    (conflicts.length > 0 && !acknowledged) || Boolean(publishDisabledReason)
  const failedAt = results?.findIndex((step) => step.status === "failed") ?? -1
  const failed = failedAt !== -1
  const laterSteps = failed && results ? results.length - failedAt - 1 : 0
  const steps = results ? stepsView(results) : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" size="wide" className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>Review changes</SheetTitle>
          <SheetDescription>
            {rows.length === 1
              ? `1 field will change on Google for ${locationName}.`
              : `${rows.length} fields will change on Google for ${locationName}.`}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          <ChangeDiff
            rows={rows}
            caption={`Changes to publish for ${locationName}`}
          />

          {conflicts.length > 0 ? (
            <Alert variant="warning" role="status">
              <AlertTitle>
                {conflicts.length === 1
                  ? `Google changed ${conflicts[0].field} after you started editing`
                  : `Google changed ${conflicts.length} of these fields after you started editing`}
              </AlertTitle>
              <AlertDescription className="flex flex-col gap-2.5">
                <span>
                  The “On Google now” column shows what Google holds. Publishing
                  replaces it with yours.
                </span>
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) =>
                    setAcknowledged(Boolean(checked))
                  }
                  label="I’ve read what Google has now and want to replace it."
                  labelClassName="text-ui"
                />
              </AlertDescription>
            </Alert>
          ) : null}

          {steps.length > 0 ? (
            <section
              aria-labelledby="review-progress"
              className="flex flex-col gap-2"
            >
              <h3
                id="review-progress"
                className="text-ui font-semibold text-ink"
              >
                Progress
              </h3>
              <PublishSteps steps={steps} aria-label="Publish progress" />
            </section>
          ) : null}

          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {failed
                ? [
                    error,
                    failedAt > 0 ? "The steps above it went through." : null,
                    laterSteps > 0 ? "Nothing after it was sent." : null,
                  ]
                    .filter(Boolean)
                    .join(" ")
                : error}
            </p>
          ) : null}

          {publishDisabledReason ? (
            <p role="note" className="text-caption text-ink-muted">
              {publishDisabledReason}
            </p>
          ) : null}
        </SheetBody>

        {/* The footer's own layout: stacked full-width buttons on a phone
            with the primary action on top, one row from sm up. */}
        <SheetFooter className="sm:items-center">
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => onOpenChange(false)}
          >
            Keep editing
          </Button>
          {onSaveDraft ? (
            <Button
              variant="secondary"
              onClick={() => void onSaveDraft()}
              disabled={publishing}
            >
              Save here
            </Button>
          ) : null}
          <Button
            onClick={() => void onPublish()}
            disabled={blocked}
            pending={publishing}
            pendingLabel="Publishing…"
          >
            {failed ? "Try again" : "Publish to Google"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

/** The flow's raw step states, in the words the app can stand behind. */
function stepsView(results: PublishStepResult[]): PublishStepView[] {
  const failedAt = results.findIndex((step) => step.status === "failed")
  return results.map((step, index) => {
    const local = step.kind === "local"
    if (step.status === "done" && step.noop)
      return {
        id: step.key,
        label: step.label,
        state: "skipped",
        stateLabel: "Nothing to send",
        detail: "Already matches Google, so no request was made.",
      }
    if (step.status === "done")
      return {
        id: step.key,
        label: step.label,
        state: local ? "skipped" : "sent",
        stateLabel: local ? "Saved here" : "Sent to Google",
        detail: local
          ? "NabaPresence’s copy. Not on Google by itself."
          : undefined,
      }
    if (step.status === "running")
      return {
        id: step.key,
        label: step.label,
        state: "pending",
        stateLabel: local ? "Saving…" : "Sending to Google…",
      }
    if (step.status === "failed")
      return {
        id: step.key,
        label: step.label,
        state: "failed",
        detail: step.message,
        errorCode: step.code,
      }
    return {
      id: step.key,
      label: step.label,
      state: failedAt !== -1 && index > failedAt ? "skipped" : "pending",
      stateLabel:
        failedAt !== -1 && index > failedAt
          ? "Not sent — an earlier step failed"
          : undefined,
    }
  })
}

export { ReviewChangesSheet }
