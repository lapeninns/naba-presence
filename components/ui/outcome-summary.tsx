import * as React from "react"

import { OUTCOME_VISUAL, outcomeGlyph } from "@/components/ui/operation-outcome"
import {
  PublishSteps,
  type PublishStep,
  type PublishStepState,
} from "@/components/ui/publish-steps"
import {
  OUTCOME_PRESENTATION,
  type OperationOutcome,
} from "@/lib/editors/outcome"
import { cn } from "@/lib/utils"

/**
 * Which outcome speaks for a set of steps, worst first. A failure anywhere
 * is the headline (the operator has something to fix); then a refusal; then
 * "not confirmed" (check Google before retrying); then the waiting states;
 * "Live on Google" only when every sent step is confirmed. `pending` and
 * `skipped` steps never set the headline.
 */
const OUTCOME_PRECEDENCE: OperationOutcome[] = [
  "failed",
  "rejected",
  "uncertain",
  "awaiting_approval",
  "awaiting_confirmation",
  "sent",
  "saved_locally",
  "confirmed_applied",
]

/**
 * The overall outcome of a reviewed write made of several steps, or `null`
 * when nothing has been attempted yet (every step pending or skipped).
 */
export function overallOutcome(
  states: readonly PublishStepState[]
): OperationOutcome | null {
  const seen = new Set(states)
  return OUTCOME_PRECEDENCE.find((outcome) => seen.has(outcome)) ?? null
}

/**
 * "2 Live on Google · 1 Failed": how many steps are in each state, in the
 * shared state words, worst first. Pending and skipped steps are counted
 * last ("1 Not sent yet").
 */
export function outcomeCounts(
  states: readonly PublishStepState[]
): { state: PublishStepState; count: number; word: string }[] {
  const order: PublishStepState[] = [
    ...OUTCOME_PRECEDENCE,
    "pending",
    "skipped",
  ]
  return order
    .map((state) => ({
      state,
      count: states.filter((s) => s === state).length,
      word:
        state === "pending"
          ? "Not sent yet"
          : state === "skipped"
            ? "Skipped"
            : OUTCOME_PRESENTATION[state].label,
    }))
    .filter((entry) => entry.count > 0)
}

/**
 * The last screen of a reviewed write (spec "Reviewed writes": review →
 * consent → send → outcome). One building block every flow can end on —
 * access, lifecycle, verification, lodging, services, place actions — so
 * they stop drawing seven different result screens (prim-20, the
 * listing-admin-profile consolidation).
 *
 *   outcome      the headline state. Omit it when passing `steps`: it is
 *                derived from them (`overallOutcome`).
 *   title        overrides the shared headline ("Opening hours sent").
 *   description  overrides the shared sentence for the outcome.
 *   steps        the per-write results, drawn as `PublishSteps` under the
 *                headline with a count line ("2 Live on Google · 1 Failed").
 *   actions      the next steps: "Retry failed", "Check Google", "Done".
 *   live         announce the summary politely when it appears (default
 *                true: it reports a result the operator just asked for).
 *
 * It says only what the caller's evidence says. The glyph, mark and words
 * come from OUTCOME_VISUAL and OUTCOME_PRESENTATION, the same maps as the
 * inline notice and the step list, so "Live on Google" appears only for a
 * `confirmed_applied` outcome. No box of its own: put it in a sheet body or
 * a Card.
 */
function OutcomeSummary({
  outcome,
  title,
  description,
  steps,
  actions,
  live = true,
  stepsLabel = "Results",
  className,
  ...props
}: Omit<React.ComponentProps<"section">, "title"> & {
  outcome?: OperationOutcome
  title?: React.ReactNode
  description?: React.ReactNode
  steps?: PublishStep[]
  actions?: React.ReactNode
  live?: boolean
  /** Names the step list for assistive tech (default "Results"). */
  stepsLabel?: string
}) {
  const states = steps?.map((step) => step.state) ?? []
  const headline = outcome ?? overallOutcome(states)
  const presentation = headline ? OUTCOME_PRESENTATION[headline] : null
  const counts = steps && steps.length > 1 ? outcomeCounts(states) : []
  const titleId = React.useId()
  return (
    <section
      data-slot="outcome-summary"
      data-outcome={headline ?? undefined}
      aria-labelledby={titleId}
      className={cn("flex flex-col gap-4", className)}
      {...props}
    >
      <div
        role={live ? "status" : undefined}
        className="flex items-start gap-3"
      >
        {headline ? (
          <span
            aria-hidden
            className={cn(
              "grid size-11 shrink-0 place-items-center rounded-full [&_svg]:size-5 [&_svg]:[stroke-width:1.75]",
              OUTCOME_VISUAL[headline].mark
            )}
          >
            {outcomeGlyph(headline)}
          </span>
        ) : null}
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titleId} className="text-section font-semibold text-ink">
            {title ?? presentation?.title ?? "Nothing sent yet"}
          </h2>
          {(description ?? presentation?.description) ? (
            <p className="text-body text-pretty text-ink-secondary">
              {description ?? presentation?.description}
            </p>
          ) : null}
          {counts.length > 0 ? (
            <p
              data-slot="outcome-summary-counts"
              className="text-ui text-ink-muted"
            >
              {counts.map((entry, index) => (
                <React.Fragment key={entry.state}>
                  {index > 0 ? <span aria-hidden> · </span> : null}
                  <span className="tabular-nums">
                    {entry.count}
                  </span>{" "}
                  {entry.word}
                  {index < counts.length - 1 ? (
                    <span className="sr-only">,</span>
                  ) : null}
                </React.Fragment>
              ))}
            </p>
          ) : null}
        </div>
      </div>
      {steps && steps.length > 0 ? (
        <PublishSteps steps={steps} live={false} aria-label={stepsLabel} />
      ) : null}
      {actions ? (
        <div
          data-slot="outcome-summary-actions"
          className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch"
        >
          {actions}
        </div>
      ) : null}
    </section>
  )
}

export { OutcomeSummary }
