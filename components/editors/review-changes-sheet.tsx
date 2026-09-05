"use client"

import { Check, Minus, X } from "lucide-react"
import * as React from "react"

import { ChangeDiff, type ChangeRow } from "@/components/editors/change-diff"
import { Button } from "@/components/ui/button"
import type { PublishStepResult } from "@/lib/editors/use-publish-flow"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"

/**
 * The confirmation step in front of every Google write.
 *
 * One sheet, not three different confirmations: some editors used a
 * dialog with a typed acknowledgement, some published straight from a
 * button, and one had a bespoke overwrite confirm. An operator publishing
 * to a client's public listing should see the same thing every time, and
 * that thing should be the actual diff rather than a sentence claiming
 * there is one.
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

  const blocked = conflicts.length > 0 && !acknowledged

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex flex-col gap-0 md:max-w-xl">
        <SheetHeader>
          <SheetTitle>Review changes</SheetTitle>
          <SheetDescription>
            {rows.length === 1
              ? `1 field will change on Google for ${locationName}.`
              : `${rows.length} fields will change on Google for ${locationName}.`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 pb-6">
          <ChangeDiff
            rows={rows}
            caption={`Changes to publish for ${locationName}`}
          />

          {conflicts.length > 0 ? (
            <div className="flex flex-col gap-3 rounded-(--np-radius-card) bg-warning-tint p-4 text-warning-ink">
              <p className="text-ui">
                {conflicts.length === 1
                  ? `Google's copy of ${conflicts[0].field} changed after you started editing. Publishing replaces it.`
                  : `Google changed ${conflicts.length} of these fields after you started editing. Publishing replaces its values.`}
              </p>
              <Label className="flex items-start gap-2.5 text-ui text-warning-ink">
                <Checkbox
                  checked={acknowledged}
                  onCheckedChange={(checked) =>
                    setAcknowledged(Boolean(checked))
                  }
                />
                <span>
                  I&rsquo;ve read what Google has now and want to replace it.
                </span>
              </Label>
            </div>
          ) : null}

          {results && results.length > 0 ? (
            <ol className="flex flex-col gap-1.5" aria-label="Publish progress">
              {results.map((step) => (
                <li key={step.key} className="flex items-center gap-2 text-ui">
                  <StepGlyph status={step.status} />
                  <span className="text-ink-muted">
                    {step.label}
                    <span className="sr-only">
                      {step.status === "done"
                        ? ": done"
                        : step.status === "failed"
                          ? ": failed"
                          : step.status === "running"
                            ? ": in progress"
                            : ": not started yet"}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {error ? (
            <p role="alert" className="text-ui text-danger-ink">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 material-toolbar px-6 py-3 [box-shadow:inset_0_0.5px_0_var(--np-line)]">
          {onSaveDraft ? (
            <Button variant="ghost" onClick={() => void onSaveDraft()}>
              Save without publishing
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Keep editing
            </Button>
            <Button
              onClick={() => void onPublish()}
              disabled={blocked || publishing}
            >
              {publishing ? "Publishing…" : "Publish to Google"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/** The per-step mark. Decorative: the sr-only text beside it carries the state. */
function StepGlyph({ status }: { status: PublishStepResult["status"] }) {
  const base = "size-4 shrink-0"
  if (status === "done")
    return (
      <Check
        className={`${base} text-success-ink`}
        strokeWidth={2}
        aria-hidden
      />
    )
  if (status === "failed")
    return (
      <X className={`${base} text-danger-ink`} strokeWidth={2} aria-hidden />
    )
  if (status === "running")
    return (
      <span className={`${base} inline-flex items-center justify-center`}>
        <Spinner decorative size="sm" />
      </span>
    )
  return (
    <Minus
      className={`${base} text-ink-faint`}
      strokeWidth={1.75}
      aria-hidden
    />
  )
}

export { ReviewChangesSheet }
