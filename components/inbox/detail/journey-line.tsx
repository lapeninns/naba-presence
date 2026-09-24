import type { LifecycleStep, LifecycleStepState } from "@/lib/inbox/lifecycle"
import { cn } from "@/lib/utils"

const STATE_WORD: Record<LifecycleStepState, string> = {
  done: "done",
  current: "current step",
  todo: "not started",
  failed: "failed",
  skipped: "skipped",
}

/**
 * Where the reply has got to, as one quiet line under the pane head
 * (reference `.journey`): a small dot per stage and its word, wrapping
 * rather than scrolling.
 *
 * Done is a filled dot, the current stage an ink ring with a halo, a failed
 * stage a filled danger dot, a skipped one a dashed ring. The state and the
 * stage's note ("Google rejected it", "By Sam") are also spoken, so the
 * dot's colour is never the only signal; sighted pointer users get the note
 * as a tooltip. Not a live region: the one spoken status is the strip on the
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
            step.state === "current" && "font-semibold text-ink",
            step.state === "failed" && "font-semibold text-danger-ink"
          )}
        >
          <span
            aria-hidden
            className={cn(
              "size-2 shrink-0 rounded-full border-[1.5px] border-line-strong",
              step.state === "done" && "border-ink-secondary bg-ink-secondary",
              step.state === "current" &&
                "border-ink shadow-[0_0_0_3px_var(--np-fill)]",
              step.state === "failed" && "border-danger-solid bg-danger-solid",
              step.state === "skipped" && "border-dashed"
            )}
          />
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
