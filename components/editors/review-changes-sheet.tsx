"use client"

import * as React from "react"

import { ChangeDiff, type ChangeRow } from "@/components/editors/change-diff"
import { OperationReceiptNotice } from "@/components/locations/operation-outcome"
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
import {
  stepOutcome,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"

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
 * NabaPresence's copy says "Saved here". A finished Google write says "Live
 * on Google" only when its step is `verified`: the endpoint read Google back
 * and the result matched before it answered (hours, food menus, the profile
 * publish, business information). Any other finished write, such as
 * attributes or lodging, says "Sent to Google".
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
  selection,
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
  /**
   * Present when the resource can publish part of a change (hours: single
   * days, dates and services). `rows` should then hold only the chosen
   * parts' rows; whatever is left out stays saved here.
   */
  selection?: {
    options: ReadonlyArray<{ key: string; label: string }>
    selected: ReadonlySet<string>
    onChange: (key: string, checked: boolean) => void
    /** What happens to the parts left out, in the resource's words. */
    note?: string
  }
}) {
  const unresolved = rows.filter((row) => row.blocking)
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
  // Choosing another part that overwrites a Google change asks again: the
  // tick covered the conflicts on screen when it was given.
  const conflictSignature = conflicts
    .map((row) => row.key ?? row.field)
    .join("\n")
  const [ackedSignature, setAckedSignature] = React.useState(conflictSignature)
  if (conflictSignature !== ackedSignature) {
    setAckedSignature(conflictSignature)
    setAcknowledged(false)
  }

  const blocked =
    (conflicts.length > 0 && !acknowledged) ||
    unresolved.length > 0 ||
    rows.length === 0 ||
    Boolean(publishDisabledReason) ||
    results?.some((step) => step.code === "google_confirmation_required")
  const failedAt = results?.findIndex((step) => step.status === "failed") ?? -1
  const failed = failedAt !== -1
  const laterSteps = failed && results ? results.length - failedAt - 1 : 0
  const steps = results ? stepsView(results) : []
  const failedStep = failed ? results?.[failedAt] : undefined
  const failedOutcome = failedStep ? stepOutcome(failedStep) : null
  const unconfirmed =
    failedStep &&
    failedStep.kind !== "local" &&
    (failedOutcome === "uncertain" || failedOutcome === "sent")
      ? failedStep
      : null
  // Once any Google request went out, the left column is the reviewed
  // baseline rather than what Google holds now.
  const sent = Boolean(
    results?.some(
      (step) => step.kind !== "local" && step.status === "done" && !step.noop
    )
  )

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
          {selection && selection.options.length > 1 ? (
            <fieldset className="flex flex-col gap-2 rounded-(--np-radius-card) border border-line bg-surface-alt px-4 py-3">
              <legend className="px-1 text-ui font-semibold text-ink">
                Choose what to publish
              </legend>
              {selection.options.map((option) => (
                <Checkbox
                  key={option.key}
                  checked={selection.selected.has(option.key)}
                  disabled={publishing}
                  onCheckedChange={(checked) =>
                    selection.onChange(option.key, Boolean(checked))
                  }
                  label={option.label}
                  labelClassName="text-ui"
                />
              ))}
              <p className="text-caption text-ink-muted">
                {selection.note ??
                  "Anything left out stays as Google has it now."}
              </p>
            </fieldset>
          ) : null}

          <ChangeDiff
            rows={rows}
            caption={`Changes to publish for ${locationName}`}
            phase={sent ? "sent" : "review"}
          />

          {unresolved.length > 0 ? (
            <Alert variant="warning" role="status">
              <AlertTitle>Resolve this comparison before publishing</AlertTitle>
              <AlertDescription>
                {[
                  ...new Set(
                    unresolved.map(
                      (row) =>
                        row.explanation ??
                        "Some entries cannot be matched reliably."
                    )
                  ),
                ].join(" ")}
              </AlertDescription>
            </Alert>
          ) : null}

          {conflicts.length > 0 ? (
            <Alert variant="warning" role="status">
              <AlertTitle>
                {conflicts.every((row) => row.observedAfterEditing)
                  ? "Google changed after you started editing"
                  : "Google holds a different version"}
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

          {unconfirmed?.intentId ? (
            // A Google step whose answer was lost: its receipt says what
            // became of it once the recovery job has read Google back.
            <OperationReceiptNotice
              receiptId={unconfirmed.intentId}
              fallback={stepOutcome(unconfirmed) ?? "uncertain"}
            />
          ) : null}

          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {failed
                ? [
                    error,
                    results?.slice(0, failedAt).some((step) => step.status === "done" && !step.noop) ? "Completed steps remain recorded." : null,
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
    // The outcome words (lib/editors/outcome.ts) say the rest: a local
    // save is "Saved here"; a Google write is what the server answered
    // (stepOutcome): "Live on Google" only when Google was read back holding
    // it, "Waiting for Google" or "Sent to Google" when it was not.
    if (step.status === "done")
      return {
        id: step.key,
        label: step.label,
        state: stepOutcome(step) ?? "sent",
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
        state: stepOutcome(step) ?? "failed",
        stateLabel: step.code === "google_confirmation_required" ? "Not confirmed" : undefined,
        detail: step.message,
        errorCode: step.code,
      }
    return {
      id: step.key,
      label: step.label,
      state: failedAt !== -1 && index > failedAt ? "skipped" : "pending",
      stateLabel:
        failedAt !== -1 && index > failedAt
          ? results[failedAt].code === "google_confirmation_required" ? "Not sent — an earlier step needs confirmation" : "Not sent — an earlier step failed"
          : undefined,
    }
  })
}

export { ReviewChangesSheet }
