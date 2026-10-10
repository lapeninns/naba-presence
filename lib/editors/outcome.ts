import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import type { StatusTone } from "@/lib/ui/status-tone"

export type { OperationOutcome } from "@/lib/contracts/mutation-operations"

/**
 * One mapping from an operation's outcome to the words, tone and toast kind
 * every surface uses for it: toasts, publish steps, status pills and the
 * inline outcome notice (components/ui/operation-outcome.tsx).
 *
 * The rule the copy follows: only `confirmed_applied` may say "live", and
 * nothing short of it may say "published". A request that left the app is
 * "sent"; a request Google took but has not shown applied is "waiting"; an
 * answer the app cannot read is "not confirmed", never "failed", because a
 * retry could then apply the change twice.
 *
 * Pure and client-safe, so tests and server components can read it.
 */
export type OutcomePresentation = {
  /** The short state word for a pill or a step ("Sent to Google"). */
  label: string
  /** A headline for a toast or a notice. */
  title: string
  /** One sentence on what it means and what to do next. */
  description: string
  tone: StatusTone
  /** The toast kind that matches the tone. */
  toast: "success" | "info" | "warning" | "error"
  /** True only when evidence shows Google holds the change. */
  live: boolean
}

export const OUTCOME_PRESENTATION: Record<
  OperationOutcome,
  OutcomePresentation
> = {
  saved_locally: {
    label: "Saved here",
    title: "Saved here",
    description:
      "NabaPresence’s copy is saved. It isn’t on Google until you publish it.",
    tone: "neutral",
    toast: "success",
    live: false,
  },
  sent: {
    label: "Sent to Google",
    title: "Sent to Google",
    description:
      "The change left NabaPresence. Google hasn’t confirmed it yet.",
    tone: "pending",
    toast: "info",
    live: false,
  },
  awaiting_confirmation: {
    label: "Waiting for Google",
    title: "Waiting for Google to confirm",
    description:
      "Google accepted the request but hasn’t shown the change yet. We’ll check again.",
    tone: "pending",
    toast: "info",
    live: false,
  },
  confirmed_applied: {
    label: "Live on Google",
    title: "Live on Google",
    description:
      "Google confirmed the change. It can take a few minutes to show on Maps and Search.",
    tone: "healthy",
    toast: "success",
    live: true,
  },
  rejected: {
    label: "Rejected by Google",
    title: "Google rejected the change",
    description: "Google refused it, so nothing changed on Google.",
    tone: "at-risk",
    toast: "error",
    live: false,
  },
  failed: {
    label: "Failed",
    title: "The change didn’t go through",
    description:
      "The request didn’t complete and nothing shows it reached Google. Your saved copy is kept.",
    tone: "at-risk",
    toast: "error",
    live: false,
  },
  uncertain: {
    label: "Not confirmed",
    title: "Couldn’t confirm with Google",
    description:
      "We can’t tell whether Google applied it. Check Google before trying again.",
    tone: "attention",
    toast: "warning",
    live: false,
  },
}

/**
 * The outcome of a mutation route's answer: its `operation.outcome`
 * (lib/contracts/mutation-operations.ts `operationSummarySchema`), or, from
 * a server that sent none, the attempt status it did send -- `succeeded`
 * meant the pipeline verified the write, anything else that it was sent.
 */
export function answerOutcome(answer: {
  status?: string
  operation?: { outcome: OperationOutcome }
}): OperationOutcome {
  return (
    answer.operation?.outcome ??
    (answer.status === "succeeded" ? "confirmed_applied" : "sent")
  )
}

/** The presentation for one outcome. */
export function describeOutcome(
  outcome: OperationOutcome
): OutcomePresentation {
  return OUTCOME_PRESENTATION[outcome]
}

/**
 * A toast or notice that names its outcome. `title`/`description` override
 * the default words for a surface that can say something more specific
 * ("Opening hours sent to Google"); the toast kind always comes from the
 * outcome, so a caller cannot dress a `sent` up as a success.
 */
export type OutcomeMessage = {
  outcome: OperationOutcome
  title?: string
  description?: string
}

/** Resolves a message to the toast fields `useToastManager().add` takes. */
export function outcomeToast(message: OutcomeMessage): {
  title: string
  description: string | undefined
  type: OutcomePresentation["toast"]
} {
  const presentation = describeOutcome(message.outcome)
  return {
    title: message.title ?? presentation.title,
    // A custom title keeps its own sentence; the default one carries the
    // outcome's explanation so the toast says what the state means.
    description:
      message.description ??
      (message.title ? undefined : presentation.description),
    type: presentation.toast,
  }
}

/**
 * What a success toast option may be: plain words (a success that is not a
 * Google write, "Post deleted") or an outcome message, whose toast kind then
 * follows the outcome.
 */
export type SuccessToastCopy = string | OutcomeMessage

/** Resolves a success toast option to the toast fields. */
export function successToastFields(copy: SuccessToastCopy): {
  title: string
  description: string | undefined
  type: OutcomePresentation["toast"]
} {
  return typeof copy === "string"
    ? { title: copy, description: undefined, type: "success" }
    : outcomeToast(copy)
}
