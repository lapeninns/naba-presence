import {
  Check,
  CircleAlert,
  CircleHelp,
  Clock,
  HardDrive,
  Hourglass,
  Send,
  UserCheck,
} from "lucide-react"
import * as React from "react"

import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert"
import { describeOutcome, type OperationOutcome } from "@/lib/editors/outcome"

/**
 * The glyph and the small round mark for each outcome, shared by this notice
 * and the publish step list so a state looks the same wherever it appears.
 */
export const OUTCOME_VISUAL: Record<
  OperationOutcome,
  { icon: React.ReactNode; mark: string }
> = {
  saved_locally: {
    icon: <HardDrive />,
    mark: "bg-fill text-ink-secondary",
  },
  awaiting_approval: {
    icon: <UserCheck />,
    mark: "bg-info-tint text-info-ink",
  },
  sent: { icon: <Send />, mark: "bg-info-tint text-info-ink" },
  awaiting_confirmation: {
    icon: <Hourglass />,
    mark: "bg-info-tint text-info-ink",
  },
  confirmed_applied: {
    icon: <Check strokeWidth={2.25} />,
    mark: "bg-success-tint text-success-ink",
  },
  rejected: { icon: <CircleAlert />, mark: "bg-danger-tint text-danger-ink" },
  failed: { icon: <CircleAlert />, mark: "bg-danger-tint text-danger-ink" },
  uncertain: {
    icon: <CircleHelp />,
    mark: "bg-warning-tint text-warning-ink",
  },
}

const ALERT_VARIANT: Record<
  OperationOutcome,
  "default" | "info" | "success" | "warning" | "destructive"
> = {
  saved_locally: "default",
  awaiting_approval: "info",
  sent: "info",
  awaiting_confirmation: "info",
  confirmed_applied: "success",
  rejected: "destructive",
  failed: "destructive",
  uncertain: "warning",
}

const ALERT_ICON: Record<OperationOutcome, React.ReactNode> = {
  saved_locally: <HardDrive aria-hidden />,
  awaiting_approval: <UserCheck aria-hidden />,
  sent: <Send aria-hidden />,
  awaiting_confirmation: <Clock aria-hidden />,
  confirmed_applied: <Check aria-hidden />,
  rejected: <CircleAlert aria-hidden />,
  failed: <CircleAlert aria-hidden />,
  uncertain: <CircleHelp aria-hidden />,
}

/**
 * The inline result of one write, in the shared outcome words
 * (lib/editors/outcome.ts): "Saved here", "Sent to Google", "Live on Google"
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
      icon={ALERT_ICON[outcome]}
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
