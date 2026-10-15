import { CircleDashed, Minus } from "lucide-react"
import * as React from "react"

import { SupportDetails } from "@/components/editors/support-details"
import { OUTCOME_VISUAL } from "@/components/ui/operation-outcome"
import { StatusPill, type PillTone } from "@/components/ui/status-pill"
import {
  OUTCOME_PRESENTATION,
  type OperationOutcome,
} from "@/lib/editors/outcome"
import type { StatusTone } from "@/lib/ui/status-tone"
import { cn } from "@/lib/utils"

/**
 * Per-step results of a publish: one row per write that went (or will go)
 * to Google, each stating its own outcome in words.
 *
 * States
 *   pending   "Not sent yet"   — queued, nothing has left the app
 *   skipped   "Skipped"        — deliberately not sent (unchanged, or
 *                                blocked by an earlier failure)
 *   and every operation outcome (lib/editors/outcome.ts), in its shared
 *   words: `saved_locally` "Saved here", `sent` "Sent to Google" (never
 *   shown as success), `awaiting_confirmation`, `confirmed_applied` "Live on
 *   Google" (only with readback or verification evidence), `rejected`,
 *   `failed` and `uncertain`. A failed step's error code is folded behind
 *   "Details for support", not shown beside the state.
 *
 * The component renders exactly the states the CALLER gives it. Only pass
 * `sent` or later when the app holds operation or verification evidence for
 * them; do not simulate progress.
 *
 * Props
 *   steps      `{ id, label, state, detail?, errorCode?, action?, stateLabel? }`
 *              — `action` is the retry slot (a small button), `stateLabel`
 *              overrides the default word for the state.
 *   live       announce changes politely (default true) — the list updates
 *              as results arrive.
 *   aria-label names the list ("Publish results").
 */
export type PublishStepState = "pending" | "skipped" | OperationOutcome

export type PublishStep = {
  id: string
  /** What this step writes, in the customer's words ("Sunday hours"). */
  label: React.ReactNode
  state: PublishStepState
  /** One line of context: when, or why it failed, in words. */
  detail?: React.ReactNode
  /** A safe, copyable error code for a failed step, shown under "Details for support". */
  errorCode?: string
  /** The retry slot, e.g. a small secondary "Retry" button. */
  action?: React.ReactNode
  /** Overrides the default state word. */
  stateLabel?: string
}

type StepMeta = {
  word: string
  tone: StatusTone | PillTone
  dashed?: boolean
  mark: string
  icon: React.ReactNode
}

const STATE_META: Record<PublishStepState, StepMeta> = {
  pending: {
    word: "Not sent yet",
    tone: "outline",
    dashed: true,
    mark: "bg-fill text-ink-secondary",
    icon: <CircleDashed />,
  },
  skipped: {
    word: "Skipped",
    tone: "outline",
    mark: "bg-fill text-ink-muted",
    icon: <Minus />,
  },
  ...(Object.fromEntries(
    Object.entries(OUTCOME_PRESENTATION).map(([outcome, presentation]) => [
      outcome,
      {
        word: presentation.label,
        tone: presentation.tone,
        ...OUTCOME_VISUAL[outcome as OperationOutcome],
      },
    ])
  ) as Record<OperationOutcome, StepMeta>),
}

function PublishSteps({
  steps,
  live = true,
  className,
  ...props
}: Omit<React.ComponentProps<"ul">, "children"> & {
  steps: PublishStep[]
  live?: boolean
}) {
  return (
    <ul
      data-slot="publish-steps"
      aria-live={live ? "polite" : undefined}
      className={cn(
        "flex list-none flex-col divide-y divide-line overflow-hidden rounded-(--np-radius-card) border border-line bg-surface",
        className
      )}
      {...props}
    >
      {steps.map((step) => {
        const meta = STATE_META[step.state]
        return (
          <li
            key={step.id}
            data-state={step.state}
            className="grid grid-cols-[--spacing(5)_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 px-4 py-3 sm:grid-cols-[--spacing(5)_minmax(0,1fr)_auto]"
          >
            <span
              aria-hidden
              className={cn(
                "mt-px grid size-5 place-items-center rounded-full [&_svg]:size-3 [&_svg]:[stroke-width:2]",
                meta.mark
              )}
            >
              {meta.icon}
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-ui font-semibold break-words text-ink">
                  {step.label}
                </span>
                <StatusPill tone={meta.tone} dashed={meta.dashed}>
                  {step.stateLabel ?? meta.word}
                </StatusPill>
              </span>
              {step.detail ? (
                <span className="text-caption text-ink-muted">
                  {step.detail}
                </span>
              ) : null}
              <SupportDetails items={[step.errorCode]} />
            </div>
            {step.action ? (
              <div className="col-start-2 flex gap-2 sm:col-start-3 sm:row-start-1">
                {step.action}
              </div>
            ) : null}
          </li>
        )
      })}
    </ul>
  )
}

export { PublishSteps }
