import { Stepper, type Step } from "@/components/ui/stepper"
import { describeOutcome, type OperationOutcome } from "@/lib/editors/outcome"

/** Where a reviewed write is: waiting for approval, ready to send, or sent. */
export type ReviewedWriteStage = "approve" | "send" | "outcome"

/**
 * The stage of a saved review: an attempt means it was sent; an approval
 * means it is ready to send; otherwise it waits for approval.
 */
export function reviewedWriteStage({
  approved,
  recorded,
}: {
  readonly approved: boolean
  readonly recorded: boolean
}): ReviewedWriteStage {
  if (recorded) return "outcome"
  return approved ? "send" : "approve"
}

const ORDER: ReviewedWriteStage[] = ["approve", "send", "outcome"]

export type ReviewedWriteStepsOptions = {
  readonly secondApprover?: boolean
  /** A send is in flight: the Send step says so. */
  readonly sending?: boolean
  /** The recorded outcome, named on the Outcome step in the shared words. */
  readonly outcome?: OperationOutcome
}

/**
 * Review → Approve → Send → Outcome, the four steps every Google write in
 * this area takes. The review step is always done (a saved review exists).
 * The Outcome step is only done once Google is independently confirmed to
 * hold the change; until then it stays current and names where it stands.
 */
export function reviewedWriteSteps(
  stage: ReviewedWriteStage,
  { secondApprover = false, sending = false, outcome }: ReviewedWriteStepsOptions = {}
): Step[] {
  const at = ORDER.indexOf(stage)
  const state = (step: ReviewedWriteStage): Step["state"] => {
    const index = ORDER.indexOf(step)
    if (index < at) return "done"
    if (index === at) return stage === "outcome" ? "done" : "current"
    return "todo"
  }
  return [
    { id: "review", label: "Review", state: "done" },
    {
      id: "approve",
      label: "Approve",
      state: state("approve"),
      meta:
        secondApprover && stage === "approve" ? "Another person" : undefined,
    },
    {
      id: "send",
      label: "Send",
      state: state("send"),
      meta:
        sending && stage === "send"
          ? describeOutcome("sent").label
          : undefined,
    },
    {
      id: "outcome",
      label: "Outcome",
      state:
        stage !== "outcome"
          ? "todo"
          : outcome === "confirmed_applied"
            ? "done"
            : "current",
      meta:
        stage === "outcome" && outcome
          ? describeOutcome(outcome).label
          : undefined,
    },
  ]
}

export function ReviewedWriteSteps({
  stage,
  secondApprover,
  sending,
  outcome,
  className,
}: ReviewedWriteStepsOptions & {
  readonly stage: ReviewedWriteStage
  /** Placement only (the steps sit flush with the title above them). */
  readonly className?: string
}) {
  return (
    <Stepper
      aria-label="Steps to send this change"
      className={className}
      showLabels
      steps={reviewedWriteSteps(stage, { secondApprover, sending, outcome })}
    />
  )
}
