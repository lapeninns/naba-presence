import { CheckIcon, XIcon } from "lucide-react"

import type { LifecycleStep, LifecycleStepState } from "@/lib/inbox/lifecycle"
import { cn } from "@/lib/utils"

const STATE_WORD: Record<LifecycleStepState, string> = {
  done: "done",
  current: "next step",
  todo: "not started",
  failed: "failed",
  skipped: "skipped",
}

/**
 * Where the reply has got to, as one quiet line under the pane head
 * (reference `.journey`): a small dot per stage and its word, wrapping
 * rather than scrolling.
 *
 * A reached stage carries a tick; a stage not reached yet is an empty ring,
 * the next one a heavier ring with a halo. They used to be a filled dot and
 * a bold ink ring, and the bold ring read as the more "done" of the two — so
 * "Drafted" looked reached on a review with no draft at all. A failed stage
 * is a cross on the danger fill, a skipped one a dashed ring. The state and
 * the stage's note ("Google rejected it", "By Sam") are also spoken, so the
 * glyph is never the only signal; sighted pointer users get the note as a
 * tooltip. Not a live region: the one spoken status is the strip on the
 * publish bar.
 */
function JourneyLine({
  steps,
  className,
}: {
  steps: LifecycleStep[]
  className?: string
}) {
  return (
    <ol
      aria-label="Reply lifecycle"
      data-slot="journey-line"
      className={cn(
        "m-0 flex list-none flex-wrap gap-x-[18px] gap-y-1 p-0 text-caption text-ink-muted",
        className
      )}
    >
      {steps.map((step) => (
        <li
          key={step.id}
          data-state={step.state}
          aria-current={step.state === "current" ? "step" : undefined}
          title={step.meta}
          className={cn(
            "inline-flex items-center gap-1.5 whitespace-nowrap",
            step.state === "done" && "text-ink-secondary",
            step.state === "current" && "font-medium text-ink",
            step.state === "failed" && "font-semibold text-danger-ink"
          )}
        >
          {step.state === "done" ? (
            <span
              aria-hidden
              data-glyph="done"
              className="grid size-3 shrink-0 place-items-center rounded-full bg-ink-secondary text-canvas"
            >
              <CheckIcon strokeWidth={3.5} className="size-2" />
            </span>
          ) : step.state === "failed" ? (
            <span
              aria-hidden
              data-glyph="failed"
              className="grid size-3 shrink-0 place-items-center rounded-full bg-danger-solid text-(--np-ink-on-accent)"
            >
              <XIcon strokeWidth={3.5} className="size-2" />
            </span>
          ) : (
            <span
              aria-hidden
              data-glyph={step.state}
              className={cn(
                "size-2.5 shrink-0 rounded-full border-[1.5px] border-line-strong bg-transparent",
                step.state === "current" &&
                  "border-2 border-ink shadow-[0_0_0_3px_var(--np-fill)]",
                step.state === "skipped" && "border-dashed"
              )}
            />
          )}
          {step.id === "approved" && step.state === "skipped"
            ? "Approval not required"
            : step.label}
          <span className="sr-only">
            , {STATE_WORD[step.state]}
            {step.meta ? `. ${step.meta}` : ""}
          </span>
        </li>
      ))}
    </ol>
  )
}

export { JourneyLine }
