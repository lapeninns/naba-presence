import type { ReactNode } from "react"
import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { describeOutcome, type OperationOutcome } from "@/lib/editors/outcome"
import { Instant } from "./instant"
import { SummaryList, type SummaryRow } from "./summary-list"

/** What Google said when the request was sent. */
export type ExecutionState = "unrecorded" | "pending" | "accepted" | "rejected" | "unknown"
/** What an independent read of Google showed afterwards. */
export type ConfirmationState = "unrecorded" | "pending" | "confirmed" | "unresolved"

/**
 * The one vocabulary for a reviewed write's two recorded facts. Every flow
 * (access, lifecycle, verification, lodging, services) says the same words
 * for the same state.
 */
export const EXECUTION_LABELS: Record<ExecutionState, string> = {
  unrecorded: "No acknowledgement recorded",
  pending: "Request still in progress",
  accepted: "Accepted by Google",
  rejected: "Rejected by Google",
  unknown: "Google acknowledgement unknown",
}

export const CONFIRMATION_LABELS: Record<ConfirmationState, string> = {
  unrecorded: "No independent confirmation recorded",
  pending: "Independent observation pending",
  confirmed: "Independently confirmed",
  unresolved: "Independent confirmation unresolved",
}

/**
 * The shared outcome (lib/editors/outcome.ts) for a recorded attempt. Only an
 * independent confirmation counts as applied; a rejection is a rejection; an
 * answer nobody can read is "not confirmed", never "failed", because a retry
 * could apply the change twice.
 */
export function attemptOutcome(
  execution: ExecutionState,
  confirmation: ConfirmationState
): OperationOutcome {
  if (execution === "rejected") return "rejected"
  if (confirmation === "confirmed") return "confirmed_applied"
  if (confirmation === "unresolved" || execution === "unknown" || execution === "unrecorded")
    return "uncertain"
  return "awaiting_confirmation"
}

/**
 * A recorded attempt's outcome: the shared outcome notice (tone, icon, words
 * from lib/editors/outcome), then the two recorded facts and when Google was
 * last read, then any flow-specific rows and notes. Words first: the outcome
 * sentence leads and stays in place (a failure persists inline, never only in
 * a toast); a Google write is never offered an Undo.
 *
 * `titles` lets a flow name a state more precisely ("Administrator removed")
 * without changing its tone; `effect` replaces the generic sentence with what
 * was actually observed.
 */
export function OutcomeSummary({
  outcome: outcomeOverride,
  execution,
  confirmation,
  observedAt,
  titles,
  effect,
  rows = [],
  actions,
  children,
  "aria-label": ariaLabel = "Recorded outcome",
}: {
  /**
   * Overrides the outcome derived from the two states, for a flow with a
   * third fact that can contradict them (a verification request Google
   * reports failed while its standing reads as confirmed).
   */
  readonly outcome?: OperationOutcome
  readonly execution: ExecutionState
  readonly confirmation: ConfirmationState
  readonly observedAt?: string | null
  readonly titles?: Partial<Record<OperationOutcome, string>>
  readonly effect?: ReactNode
  readonly rows?: readonly SummaryRow[]
  readonly actions?: ReactNode
  readonly children?: ReactNode
  readonly "aria-label"?: string
}) {
  const outcome = outcomeOverride ?? attemptOutcome(execution, confirmation)
  const presentation = describeOutcome(outcome)
  return (
    <div data-slot="outcome-summary" aria-label={ariaLabel} role="group" className="flex min-w-0 flex-col gap-4">
      <OperationOutcomeNotice
        outcome={outcome}
        title={titles?.[outcome] ?? presentation.title}
        description={effect ?? presentation.description}
      />
      <SummaryList
        rows={[
          { label: "Google’s answer", value: EXECUTION_LABELS[execution] },
          { label: "Independent check", value: CONFIRMATION_LABELS[confirmation] },
          {
            label: "Checked on Google",
            value: observedAt ? <Instant value={observedAt} /> : "No dated observation recorded",
          },
          ...rows,
        ]}
      />
      {children}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}
