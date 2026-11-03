import * as React from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { STATUS_GLYPH_ICON } from "@/components/ui/status-glyph"
import {
  describeOutcome,
  OUTCOME_PRESENTATION,
  type OperationOutcome,
} from "@/lib/editors/outcome"
import { OPERATION_OUTCOMES } from "@/lib/contracts/mutation-operations"
import { TONE_CLASSES } from "@/lib/ui/status-tone"

/**
 * The glyph and the small round mark for each outcome: the ONE map, read by
 * this notice, the publish step list and OutcomeSummary, so a state looks
 * the same wherever it appears. Both come from the outcome's presentation
 * (lib/editors/outcome.ts), so the notice, the pill and the change track
 * cannot disagree on a shape or a tone.
 */
export const OUTCOME_VISUAL = Object.fromEntries(
  OPERATION_OUTCOMES.map((outcome) => {
    const { glyph, tone } = OUTCOME_PRESENTATION[outcome]
    const Icon = STATUS_GLYPH_ICON[glyph]
    const classes = TONE_CLASSES[tone]
    return [
      outcome,
      {
        icon: <Icon strokeWidth={2} />,
        mark: `${classes.tint} ${classes.text}`,
      },
    ]
  })
) as Record<OperationOutcome, { icon: React.ReactNode; mark: string }>

const ALERT_VARIANT: Record<
  OperationOutcome,
  "default" | "info" | "success" | "warning" | "destructive"
> = {
  saved_locally: "default",
  // Amber: a person approves next, the same tone on every surface.
  awaiting_approval: "warning",
  sent: "info",
  awaiting_confirmation: "info",
  confirmed_applied: "success",
  rejected: "destructive",
  failed: "destructive",
  uncertain: "warning",
}

/** The outcome's glyph from `OUTCOME_VISUAL`, hidden from assistive tech. */
export function outcomeGlyph(outcome: OperationOutcome): React.ReactNode {
  const icon = OUTCOME_VISUAL[outcome].icon
  return React.isValidElement<{ "aria-hidden"?: boolean }>(icon)
    ? React.cloneElement(icon, { "aria-hidden": true })
    : icon
}

/**
 * The inline result of one write, in the shared outcome words
 * (lib/editors/outcome.ts): "Draft saved", "Sending to Google", "On Google"
 * only with confirmation, and so on.
 *
 * Always a polite live region, whatever the tone: the notice reports a
 * result the operator asked for, it does not interrupt them.
 *
 * Props
 *   outcome      the state to report.
 *   title        overrides the default headline ("Opening hours sent").
 *   description  overrides the default sentence; `children` add to it.
 *   action       the retry or reconcile slot ("Check Google", "Retry").
 */
function OperationOutcomeNotice({
  outcome,
  title,
  description,
  action,
  children,
  ...props
}: Omit<React.ComponentProps<"div">, "title"> & {
  outcome: OperationOutcome
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  const presentation = describeOutcome(outcome)
  return (
    <Alert
      variant={ALERT_VARIANT[outcome]}
      icon={outcomeGlyph(outcome)}
      data-outcome={outcome}
      {...props}
      role="status"
      aria-live="polite"
    >
      <AlertTitle>{title ?? presentation.title}</AlertTitle>
      <AlertDescription>
        {description ?? presentation.description}
        {children}
      </AlertDescription>
      {action ? <AlertActions>{action}</AlertActions> : null}
    </Alert>
  )
}

export { OperationOutcomeNotice }
