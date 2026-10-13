import { Stepper, type Step } from "@/components/ui/stepper"

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

/**
 * Review → Approve → Send → Outcome, the four steps every Google write in
 * this area takes. The review step is always done (a saved review exists).
 */
export function reviewedWriteSteps(
  stage: ReviewedWriteStage,
  { secondApprover = false }: { readonly secondApprover?: boolean } = {}
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
      meta: secondApprover && stage === "approve" ? "Another person" : undefined,
    },
    { id: "send", label: "Send", state: state("send") },
    { id: "outcome", label: "Outcome", state: stage === "outcome" ? "current" : "todo" },
  ]
}

export function ReviewedWriteSteps({
  stage,
  secondApprover,
  className,
}: {
  readonly stage: ReviewedWriteStage
  readonly secondApprover?: boolean
  /** Placement only (the steps sit flush with the title above them). */
  readonly className?: string
}) {
  return (
    <Stepper
      aria-label="Steps to send this change"
      className={className}
      steps={reviewedWriteSteps(stage, { secondApprover })}
    />
  )
}
