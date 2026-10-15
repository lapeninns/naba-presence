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
  stepOutcome,
  type PublishStepResult,
} from "@/lib/editors/use-publish-flow"
import { ReviewedWriteSheet } from "./sheet"

/**
 * One change in a combined review: a field-level diff row, plus where it
 * goes and which publish steps carry it.
 *
 * - `here`: NabaPresence keeps a copy. Publishing saves the copy first, then
 *   sends it to Google (a profile's name, description, phone and website).
 * - `google`: no copy here. The change is an exact request, prepared when
 *   the review opened, then approved and sent from this one sheet
 *   (categories, address, opening state, attributes).
 */
export type CombinedReviewRow = ChangeRow & {
  readonly route: "here" | "google"
  /** The publish-flow step keys that carry this row, in run order. */
  readonly steps: readonly string[]
  /** A short noun for the sheet's one plain line ("name", "phone"). */
  readonly noun?: string
  /**
   * The request needs a different person's approval before it can go to
   * Google (two-person mode). The plain line says so; the caller keeps
   * publishing off until that person approves it.
   */
  readonly waitsForApprover?: boolean
}

/** Lower-cases a label inside a sentence unless it carries its own capitals ("Wi-Fi"). */
function inSentence(label: string): string {
  const rest = label.slice(1)
  return rest === rest.toLowerCase() ? label.toLowerCase() : label
}

const LISTED = 3

/** "name, phone and website"; past three, "… and 2 more". */
function listOf(nouns: readonly string[]): string {
  if (nouns.length <= 1) return nouns[0] ?? ""
  if (nouns.length > LISTED)
    return `${nouns.slice(0, LISTED).join(", ")} and ${nouns.length - LISTED} more`
  return `${nouns.slice(0, -1).join(", ")} and ${nouns[nouns.length - 1]}`
}

function nounsOf(rows: readonly CombinedReviewRow[]): string[] {
  return [...new Set(rows.map((row) => inSentence(row.noun ?? row.field)))]
}

/**
 * The sheet's one plain line saying where each change goes, built from what
 * is actually in the sheet: "Name and phone save here first; store code
 * goes to Google when you publish." No internal model names. Null for an
 * empty sheet.
 */
export function combinedReviewNote(
  rows: readonly CombinedReviewRow[]
): string | null {
  const here = nounsOf(rows.filter((row) => row.route === "here"))
  const google = nounsOf(
    rows.filter((row) => row.route === "google" && !row.waitsForApprover)
  )
  const waiting = nounsOf(
    rows.filter((row) => row.route === "google" && row.waitsForApprover)
  )
  const parts: string[] = []
  if (here.length > 0)
    parts.push(
      `${listOf(here)} ${here.length === 1 ? "saves" : "save"} here first` +
        (google.length === 0 && waiting.length === 0
          ? `, then ${here.length === 1 ? "goes" : "go"} to Google when you publish`
          : "")
    )
  if (google.length > 0)
    parts.push(
      `${listOf(google)} ${google.length === 1 ? "goes" : "go"} to Google when you publish`
    )
  if (waiting.length > 0)
    parts.push(
      `${listOf(waiting)} ${waiting.length === 1 ? "waits" : "wait"} for another publisher to approve before ${waiting.length === 1 ? "it goes" : "they go"} to Google`
    )
  if (parts.length === 0) return null
  const sentence = parts.join("; ")
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`
}

/** Words for a step that never ran because an earlier one stopped the publish. */
function notSentLabel(results: readonly PublishStepResult[], failedAt: number) {
  return results[failedAt]?.code === "google_confirmation_required"
    ? "Not sent — an earlier step needs confirmation"
    : "Not sent — an earlier step failed"
}

const SAVED_HERE_DETAIL = "NabaPresence’s copy. Not on Google by itself."

/** One step's result as a row view, in the words the app can stand behind. */
function stepView(
  id: string,
  label: React.ReactNode,
  step: PublishStepResult,
  savedHere: boolean
): PublishStepView {
  if (step.status === "failed")
    return {
      id,
      label,
      state: stepOutcome(step) ?? "failed",
      stateLabel:
        step.code === "google_confirmation_required"
          ? "Not confirmed"
          : undefined,
      detail: [savedHere ? "Saved here." : null, step.message]
        .filter(Boolean)
        .join(" "),
      errorCode: step.code,
    }
  if (step.status === "running")
    return {
      id,
      label,
      state: "pending",
      stateLabel: step.kind === "local" ? "Saving…" : "Sending to Google…",
    }
  if (step.status === "done" && step.noop)
    return savedHere
      ? {
          id,
          label,
          state: "saved_locally",
          detail: "Already matches Google, so no request was made.",
        }
      : {
          id,
          label,
          state: "skipped",
          stateLabel: "Nothing to send",
          detail: "Already matches Google, so no request was made.",
        }
  if (step.status === "done") {
    const outcome = stepOutcome(step) ?? "sent"
    return {
      id,
      label,
      state: outcome,
      // Waiting for another person: say who, never that it was sent.
      detail:
        outcome === "awaiting_approval"
          ? step.message
          : step.kind === "local"
            ? SAVED_HERE_DETAIL
            : undefined,
    }
  }
  return { id, label, state: "pending" }
}

/**
 * Per-row results: each change in the sheet with the outcome of the steps
 * that carry it. A row carried by a save and then a publish shows the
 * furthest point it reached ("Saved here", then "Live on Google"); a failure
 * shows on every row it stopped. Steps that carry no row (a publish that
 * found nothing to send) appear only when they did something or failed, so
 * nothing is hidden.
 */
export function combinedRowResults(
  rows: readonly CombinedReviewRow[],
  results: readonly PublishStepResult[]
): PublishStepView[] {
  if (results.length === 0) return []
  const failedAt = results.findIndex((step) => step.status === "failed")
  const views: PublishStepView[] = rows.map((row) => {
    const id = row.key ?? row.field
    const mine = results
      .map((step, index) => ({ step, index }))
      .filter(({ step }) => row.steps.includes(step.key))
    if (mine.length === 0) return { id, label: row.field, state: "pending" }
    const savedHere = mine.some(
      ({ step }) => step.kind === "local" && step.status === "done"
    )
    const active = mine.find(
      ({ step }) => step.status === "failed" || step.status === "running"
    )
    if (active) return stepView(id, row.field, active.step, savedHere)
    const pending = mine.find(({ step }) => step.status === "pending")
    if (pending) {
      if (failedAt !== -1 && pending.index > failedAt)
        return {
          id,
          label: row.field,
          state: "skipped",
          stateLabel: notSentLabel(results, failedAt),
          detail: savedHere ? "Saved here. Not on Google." : undefined,
        }
      return savedHere
        ? {
            id,
            label: row.field,
            state: "saved_locally",
            detail: SAVED_HERE_DETAIL,
          }
        : { id, label: row.field, state: "pending" }
    }
    const last = mine[mine.length - 1]!.step
    return stepView(id, row.field, last, savedHere && last.kind !== "local")
  })
  const carried = new Set(rows.flatMap((row) => row.steps))
  for (const step of results) {
    if (carried.has(step.key)) continue
    if (step.status === "failed" || (step.status === "done" && !step.noop))
      views.push(stepView(`step-${step.key}`, step.label, step, false))
  }
  return views
}

/**
 * The one "Review changes" sheet for an editor whose fields take two routes
 * to Google (the business profile): fields NabaPresence keeps a copy of and
 * exact requests prepared for Google, listed together with one plain line
 * saying where each goes, one consent (the publish button, plus the
 * overwrite acknowledgement when Google changed something) and a result for
 * every row.
 *
 * Built on `ReviewedWriteSheet` (bottom sheet on a phone, side panel from
 * `sm`) and `PublishSteps`, with the same diff, conflict and receipt rules as
 * the editors' review sheet (components/editors/review-changes-sheet.tsx).
 */
export function CombinedReviewSheet({
  open,
  onOpenChange,
  rows,
  locationName,
  onPublish,
  publishing,
  results = [],
  error,
  publishDisabledReason,
}: {
  readonly open: boolean
  readonly onOpenChange: (open: boolean) => void
  readonly rows: readonly CombinedReviewRow[]
  readonly locationName: string
  readonly onPublish: () => void | Promise<void>
  readonly publishing?: boolean
  /** The publish flow's per-step results, mapped onto the rows. */
  readonly results?: readonly PublishStepResult[]
  readonly error?: string | null
  /** Why publishing can't run right now (paused, no permission). */
  readonly publishDisabledReason?: string | null
}) {
  const diffRows: ChangeRow[] = [...rows]
  const unresolved = rows.filter((row) => row.blocking)
  const conflicts = rows.filter((row) => row.state === "conflict")
  const [acknowledged, setAcknowledged] = React.useState(false)
  // A fresh sheet asks again: a tick carried over from an earlier review
  // would publish an overwrite nobody saw. Reset during render (React's
  // "adjust state when a prop changes" pattern), so it is never briefly on.
  const [wasOpen, setWasOpen] = React.useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setAcknowledged(false)
  }
  const conflictSignature = conflicts
    .map((row) => row.key ?? row.field)
    .join("\n")
  const [ackedSignature, setAckedSignature] = React.useState(conflictSignature)
  if (conflictSignature !== ackedSignature) {
    setAckedSignature(conflictSignature)
    setAcknowledged(false)
  }

  const failedAt = results.findIndex((step) => step.status === "failed")
  const failed = failedAt !== -1
  const finished =
    results.length > 0 &&
    !publishing &&
    !failed &&
    results.every((step) => step.status === "done")
  const blocked =
    (conflicts.length > 0 && !acknowledged) ||
    unresolved.length > 0 ||
    rows.length === 0 ||
    Boolean(publishDisabledReason) ||
    results.some((step) => step.code === "google_confirmation_required")
  const laterSteps = failed ? results.length - failedAt - 1 : 0
  const failedStep = failed ? results[failedAt] : undefined
  const failedOutcome = failedStep ? stepOutcome(failedStep) : null
  const unconfirmed =
    failedStep &&
    failedStep.kind !== "local" &&
    (failedOutcome === "uncertain" || failedOutcome === "sent")
      ? failedStep
      : null
  // Once a Google request went out, the left column is the reviewed baseline
  // rather than what Google holds now. A request left waiting for another
  // approver has not gone out.
  const sent = results.some(
    (step) =>
      step.kind !== "local" &&
      step.status === "done" &&
      !step.noop &&
      step.outcome !== "awaiting_approval"
  )
  const note = combinedReviewNote(rows)
  const views = combinedRowResults(rows, results)

  return (
    <ReviewedWriteSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Review changes"
      description={
        rows.length === 1
          ? `1 change for ${locationName}.`
          : `${rows.length} changes for ${locationName}.`
      }
      footer={
        <>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            onClick={() => onOpenChange(false)}
          >
            {finished ? "Done" : "Keep editing"}
          </Button>
          {finished ? null : (
            <Button
              onClick={() => void onPublish()}
              disabled={blocked}
              pending={publishing}
              pendingLabel="Publishing…"
            >
              {failed ? "Try again" : "Publish to Google"}
            </Button>
          )}
        </>
      }
    >
      {note ? (
        <p
          data-slot="review-route-note"
          className="text-ui text-pretty text-ink-secondary"
        >
          {note}
        </p>
      ) : null}

      <ChangeDiff
        rows={diffRows}
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
              onCheckedChange={(checked) => setAcknowledged(Boolean(checked))}
              label="I’ve read what Google has now and want to replace it."
              labelClassName="text-ui"
            />
          </AlertDescription>
        </Alert>
      ) : null}

      {views.length > 0 ? (
        <section
          aria-labelledby="combined-review-progress"
          className="flex flex-col gap-2"
        >
          <h3
            id="combined-review-progress"
            className="text-caption font-medium text-ink-muted"
          >
            Progress
          </h3>
          <PublishSteps steps={views} aria-label="Publish progress" />
        </section>
      ) : null}

      {unconfirmed?.intentId ? (
        // A Google step whose answer was lost: its receipt says what became
        // of it once the recovery job has read Google back.
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
                results
                  .slice(0, failedAt)
                  .some((step) => step.status === "done" && !step.noop)
                  ? "Completed steps remain recorded."
                  : null,
                laterSteps > 0 ? "Nothing after it was sent." : null,
              ]
                .filter(Boolean)
                .join(" ")
            : error}
        </p>
      ) : null}

      {/* Once everything has run, the results are the news; a stale-review
          note would only contradict them. */}
      {publishDisabledReason && !finished ? (
        <p role="note" className="text-caption text-ink-muted">
          {publishDisabledReason}
        </p>
      ) : null}
    </ReviewedWriteSheet>
  )
}
