import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import type { StatusTone } from "@/lib/ui/status-tone"

export type { OperationOutcome } from "@/lib/contracts/mutation-operations"

/**
 * The status vocabulary for every change that can reach Google
 * (docs/redesign/2026-11/DIRECTION.md §6.1, "Proof desk"): one label per
 * state, used on pills, change-track stops, dispatch-bar status lines, list
 * rows, toasts and notifications. Sentence case. A state label never says
 * "published" or "live"; only `live` says "On Google", and only when Google
 * has confirmed it by readback or by its own state.
 *
 * The tone says who acts next: neutral nobody, amber (`attention`) a person,
 * blue (`pending`) Google or our system, green (`healthy`) confirmed on
 * Google, red (`at-risk`) broken. Each tone family has its own glyph shapes
 * (lucide names below), so a state never relies on hue.
 */
export const STATUS_KEYS = [
  "unsaved",
  "draft",
  "blocked",
  "needsReply",
  "approval",
  "changes",
  "approved",
  "sending",
  "retrying",
  "waiting",
  "live",
  "uncertain",
  "rejected",
  "failed",
  "conflict",
  "withdrawn",
  "expired",
  "replaced",
] as const
export type StatusKey = (typeof STATUS_KEYS)[number]

/** The lucide glyph per state (rendered by components/ui/status-pill.tsx). */
export type StatusGlyph =
  | "circle-dashed"
  | "hard-drive"
  | "octagon-x"
  | "message-circle"
  | "user-check"
  | "undo-2"
  | "circle-check"
  | "send"
  | "refresh-cw"
  | "hourglass"
  | "badge-check"
  | "circle-help"
  | "ban"
  | "triangle-alert"
  | "git-compare"
  | "circle-minus"

/** The four stops of the change track, in order. */
export const TRACK_STOPS = ["saved", "approved", "sent", "google"] as const
export type TrackStop = (typeof TRACK_STOPS)[number]

/** Where a state sits on the change track; `null` is not a Google step. */
export type TrackPosition = {
  /** The stop that is current (or failed); earlier stops are done. */
  stop: TrackStop
  /** The stop failed: drawn in danger with the state's own label. */
  failed?: boolean
  /** Every stop is done, and the reached On Google stop is green. */
  reached?: boolean
} | null

export type StatusVocabulary = {
  /** The pill label: short, sentence case ("Sent, waiting for Google"). */
  label: string
  /**
   * The long form for a dispatch-bar status line or a toast title, with
   * `{n}`, `{time}` or `{name}` where a caller fills in specifics.
   */
  long: string
  tone: StatusTone
  glyph: StatusGlyph
  track: TrackPosition
}

export const STATUS_VOCABULARY: Record<StatusKey, StatusVocabulary> = {
  unsaved: {
    label: "Unsaved changes",
    long: "{n} unsaved changes",
    tone: "neutral",
    glyph: "circle-dashed",
    track: null,
  },
  draft: {
    label: "Draft saved",
    long: "Saved here, not on Google",
    tone: "neutral",
    glyph: "hard-drive",
    track: { stop: "saved" },
  },
  blocked: {
    label: "Blocked by checks",
    long: "Blocked: fix the reply to publish",
    tone: "at-risk",
    glyph: "octagon-x",
    track: { stop: "approved", failed: true },
  },
  needsReply: {
    label: "Needs reply",
    long: "Needs reply",
    tone: "neutral",
    glyph: "message-circle",
    track: null,
  },
  approval: {
    label: "Awaiting approval",
    long: "Awaiting approval",
    tone: "attention",
    glyph: "user-check",
    track: { stop: "approved" },
  },
  changes: {
    label: "Sent back",
    long: "Sent back by {name}",
    tone: "attention",
    glyph: "undo-2",
    track: { stop: "saved" },
  },
  approved: {
    label: "Approved, ready to send",
    long: "Approved by {name}. Publish when ready.",
    tone: "attention",
    glyph: "circle-check",
    track: { stop: "sent" },
  },
  sending: {
    label: "Sending to Google",
    long: "Sending to Google…",
    tone: "pending",
    glyph: "send",
    track: { stop: "sent" },
  },
  retrying: {
    label: "Will retry at {time}",
    long: "Google is busy. We’ll retry at {time}.",
    tone: "pending",
    glyph: "refresh-cw",
    track: { stop: "sent" },
  },
  waiting: {
    label: "Sent, waiting for Google",
    long: "Sent, waiting for Google to confirm",
    tone: "pending",
    glyph: "hourglass",
    track: { stop: "google" },
  },
  live: {
    label: "On Google",
    long: "Confirmed on Google",
    tone: "healthy",
    glyph: "badge-check",
    track: { stop: "google", reached: true },
  },
  uncertain: {
    label: "Not confirmed: check Google",
    long: "We can’t tell whether Google applied it",
    tone: "attention",
    glyph: "circle-help",
    track: { stop: "sent" },
  },
  rejected: {
    label: "Rejected by Google",
    long: "Google refused it. Nothing changed on Google.",
    tone: "at-risk",
    glyph: "ban",
    track: { stop: "sent", failed: true },
  },
  failed: {
    label: "Failed: retry",
    long: "It didn’t go through. Nothing changed on Google.",
    tone: "at-risk",
    glyph: "triangle-alert",
    track: { stop: "sent", failed: true },
  },
  conflict: {
    label: "Changed on Google",
    long: "Google changed this since you saved it",
    tone: "attention",
    glyph: "git-compare",
    track: null,
  },
  withdrawn: {
    label: "Withdrawn",
    long: "Withdrawn. Nothing was sent to Google.",
    tone: "neutral",
    glyph: "circle-minus",
    track: null,
  },
  expired: {
    label: "Expired, not sent",
    long: "Expired. Nothing was sent to Google.",
    tone: "neutral",
    glyph: "circle-minus",
    track: null,
  },
  replaced: {
    label: "Replaced",
    long: "Replaced by a newer change. Nothing was sent to Google.",
    tone: "neutral",
    glyph: "circle-minus",
    track: null,
  },
}

/** The vocabulary entry for one state. */
export function describeStatus(key: StatusKey): StatusVocabulary {
  return STATUS_VOCABULARY[key]
}

/**
 * Fills a label or long form's `{n}`, `{time}` and `{name}` slots. A slot
 * with no value is dropped with the words that only make sense beside it
 * ("Sent back by {name}" without a name reads "Sent back").
 */
export function statusText(
  template: string,
  values: { n?: number; time?: string; name?: string } = {}
): string {
  let text = template
  if (values.name) text = text.replace("{name}", values.name)
  else text = text.replace(/ by \{name\}/, "").replace("{name}", "")
  if (values.time) text = text.replace(/\{time\}/g, values.time)
  else text = text.replace(/ at \{time\}/g, " later")
  if (values.n !== undefined) {
    text = text.replace("{n}", String(values.n))
    if (values.n === 1) text = text.replace("changes", "change")
  } else text = text.replace("{n} unsaved changes", "Unsaved changes")
  return text
}

/**
 * One mapping from an operation's outcome to the words, tone and toast kind
 * every surface uses for it: toasts, publish steps, status pills and the
 * inline outcome notice (components/ui/operation-outcome.tsx).
 *
 * The rule the copy follows: only `confirmed_applied` may say "On Google",
 * and nothing short of it may say "published" or "live". A request that left
 * the app is "sent"; a request Google took but has not shown applied is
 * "waiting"; an answer the app cannot read is "not confirmed", never
 * "failed", because a retry could then apply the change twice.
 *
 * Beside the eight operation outcomes it carries the lifecycle states that
 * are not operation outcomes (`unsaved`, `blocked`, `changes`, `approved`,
 * `retrying`, `conflict`, `withdrawn`), worded from STATUS_VOCABULARY, so a
 * surface reads every state from this one map.
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
  /** The vocabulary state that draws its glyph and change-track position. */
  status: StatusKey
}

/** The lifecycle states that are not operation outcomes. */
export const LIFECYCLE_ONLY_STATES = [
  "unsaved",
  "blocked",
  "changes",
  "approved",
  "retrying",
  "conflict",
  "withdrawn",
] as const
export type LifecycleOnlyState = (typeof LIFECYCLE_ONLY_STATES)[number]

/** Every state OUTCOME_PRESENTATION words. */
export type PresentedState = OperationOutcome | LifecycleOnlyState

export const OUTCOME_PRESENTATION: Record<
  PresentedState,
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
    status: "draft",
  },
  awaiting_approval: {
    label: "Awaiting approval",
    title: "Sent for approval",
    description:
      "Nothing has gone to Google yet. Another publisher needs to approve this change first.",
    // Amber: a person acts next (DIRECTION §6.3 #8, one tone everywhere).
    tone: "attention",
    toast: "info",
    live: false,
    status: "approval",
  },
  sent: {
    label: "Sent to Google",
    title: "Sent to Google",
    description:
      "The change left NabaPresence. Google hasn’t confirmed it yet.",
    tone: "pending",
    toast: "info",
    live: false,
    status: "sending",
  },
  awaiting_confirmation: {
    label: "Waiting for Google",
    title: "Waiting for Google to confirm",
    description:
      "Google accepted the request but hasn’t shown the change yet. We’ll check again.",
    tone: "pending",
    toast: "info",
    live: false,
    status: "waiting",
  },
  confirmed_applied: {
    label: STATUS_VOCABULARY.live.label,
    title: STATUS_VOCABULARY.live.long,
    description:
      "Google confirmed the change. It can take a few minutes to show on Maps and Search.",
    tone: "healthy",
    toast: "success",
    live: true,
    status: "live",
  },
  rejected: {
    label: "Rejected by Google",
    title: "Google rejected the change",
    description: "Google refused it, so nothing changed on Google.",
    tone: "at-risk",
    toast: "error",
    live: false,
    status: "rejected",
  },
  failed: {
    label: "Failed",
    title: "The change didn’t go through",
    description:
      "The request didn’t complete and nothing shows it reached Google. Your saved copy is kept.",
    tone: "at-risk",
    toast: "error",
    live: false,
    status: "failed",
  },
  uncertain: {
    label: "Not confirmed",
    title: "Couldn’t confirm with Google",
    description:
      "We can’t tell whether Google applied it. Check Google before trying again.",
    tone: "attention",
    toast: "warning",
    live: false,
    status: "uncertain",
  },
  unsaved: {
    label: STATUS_VOCABULARY.unsaved.label,
    title: STATUS_VOCABULARY.unsaved.label,
    description: "Only in this browser tab. Save to keep them.",
    tone: "neutral",
    toast: "info",
    live: false,
    status: "unsaved",
  },
  blocked: {
    label: STATUS_VOCABULARY.blocked.label,
    title: STATUS_VOCABULARY.blocked.long,
    description:
      "A check failed, so publishing is blocked. Nothing has gone to Google.",
    tone: "at-risk",
    toast: "error",
    live: false,
    status: "blocked",
  },
  changes: {
    label: STATUS_VOCABULARY.changes.label,
    title: STATUS_VOCABULARY.changes.label,
    description:
      "The approver sent it back to the author. Nothing has gone to Google.",
    tone: "attention",
    toast: "warning",
    live: false,
    status: "changes",
  },
  approved: {
    label: STATUS_VOCABULARY.approved.label,
    title: "Approved. Publish when ready.",
    description: "Approved, but not sent yet. Nothing has gone to Google.",
    tone: "attention",
    toast: "info",
    live: false,
    status: "approved",
  },
  retrying: {
    label: "Will retry",
    title: "Google is busy. We’ll retry.",
    description:
      "Google asked us to wait. We’ll send it again automatically; nothing has changed on Google yet.",
    tone: "pending",
    toast: "info",
    live: false,
    status: "retrying",
  },
  conflict: {
    label: STATUS_VOCABULARY.conflict.label,
    title: STATUS_VOCABULARY.conflict.long,
    description:
      "Google’s copy changed after you saved yours. Compare them before you send.",
    tone: "attention",
    toast: "warning",
    live: false,
    status: "conflict",
  },
  withdrawn: {
    label: STATUS_VOCABULARY.withdrawn.label,
    title: STATUS_VOCABULARY.withdrawn.long,
    description: "The change was withdrawn before it was sent.",
    tone: "neutral",
    toast: "info",
    live: false,
    status: "withdrawn",
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

/** The presentation for one outcome or lifecycle state. */
export function describeOutcome(
  outcome: PresentedState
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
