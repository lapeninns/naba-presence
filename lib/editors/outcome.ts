import type { OperationOutcome } from "@/lib/contracts/mutation-operations"
import type { StatusTone } from "@/lib/ui/status-tone"

export type { OperationOutcome } from "@/lib/contracts/mutation-operations"

/**
 * The lucide glyph per state, drawn by components/ui/status-glyph.tsx. Each
 * tone family has its own shapes, so a state never relies on hue.
 */
export type StatusGlyph =
  | "circle-dashed"
  | "hard-drive"
  | "octagon-x"
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

/**
 * Where a state sits on the change track (components/ui/change-track.tsx);
 * `null` for a state that is not a step towards Google.
 */
export type TrackPosition = {
  /** The stop that is current (or failed); earlier stops are done. */
  stop: TrackStop
  /** The stop failed: drawn in danger with the state's own label. */
  failed?: boolean
  /** Every stop is done, and the reached On Google stop is green. */
  reached?: boolean
  /**
   * The current stop is not the change's next step but Google's: spoken as
   * "waiting for Google", never "current step".
   */
  waitingOn?: "Google"
} | null

/**
 * One mapping from a change's state to the words, tone, glyph and track
 * position every surface uses for it: status pills, change-track stops,
 * dispatch-bar status lines, list rows, toasts and the inline outcome notice
 * (components/ui/operation-outcome.tsx). The words are the "Proof desk"
 * vocabulary (docs/redesign/2026-11/DIRECTION.md §6.1), verbatim.
 *
 * The rule the copy follows: only `confirmed_applied` may say "On Google",
 * and no state label says "published" or "live". A request that left the
 * app is "sending"; a request Google took but has not shown applied is
 * "waiting"; an answer the app cannot read is "not confirmed", never
 * "failed", because a retry could then apply the change twice.
 *
 * The tone says who acts next: neutral nobody, amber (`attention`) a person,
 * blue (`pending`) Google or our system, green (`healthy`) confirmed on
 * Google, red (`at-risk`) broken.
 *
 * Beside the eight operation outcomes the map carries the lifecycle states
 * that are not operation outcomes (`LIFECYCLE_ONLY_STATES`), so a surface
 * reads every state from this one map.
 *
 * Pure and client-safe, so tests and server components can read it.
 */
export type OutcomePresentation = {
  /** The pill label: short, sentence case ("Sent, waiting for Google"). */
  label: string
  /**
   * The long form for a toast title or a dispatch-bar status line. It may
   * hold `{n}`, `{time}` or `{name}` slots; fill them with `statusText`.
   */
  title: string
  /** One sentence on what it means and what to do next. */
  description: string
  tone: StatusTone
  /**
   * The toast kind that matches the tone: `neutral` for a state nobody
   * acts on and Google does not hold, `success` only for On Google.
   */
  toast: "neutral" | "success" | "info" | "warning" | "error"
  /** True only when evidence shows Google holds the change. */
  live: boolean
  glyph: StatusGlyph
  track: TrackPosition
}

/** The lifecycle states that are not operation outcomes (DIRECTION §6.2). */
export const LIFECYCLE_ONLY_STATES = [
  "unsaved",
  "blocked",
  "changes",
  "approved",
  "retrying",
  "conflict",
  "withdrawn",
  "expired",
  "replaced",
] as const
export type LifecycleOnlyState = (typeof LIFECYCLE_ONLY_STATES)[number]

/** Every state OUTCOME_PRESENTATION words. */
export type PresentedState = OperationOutcome | LifecycleOnlyState

/**
 * The Inbox queue label for a review with no reply yet. Rows in that queue
 * carry no pill, so it is a label rather than a presented state.
 */
export const NEEDS_REPLY_LABEL = "Needs reply"

export const OUTCOME_PRESENTATION: Record<PresentedState, OutcomePresentation> =
  {
    saved_locally: {
      label: "Draft saved",
      title: "Saved here, not on Google",
      description:
        "NabaPresence’s copy is saved. It isn’t on Google until you publish it.",
      tone: "neutral",
      toast: "neutral",
      live: false,
      glyph: "hard-drive",
      track: { stop: "saved" },
    },
    awaiting_approval: {
      label: "Awaiting approval",
      title: "Awaiting approval",
      description:
        "Nothing has gone to Google yet. Another publisher needs to approve this change first.",
      // Amber: a person acts next, the same tone on every surface.
      tone: "attention",
      toast: "info",
      live: false,
      glyph: "user-check",
      track: { stop: "approved" },
    },
    // While a write is unsettled it is still on its way; once Google answers
    // without proof it settles as `awaiting_confirmation`.
    sent: {
      label: "Sending to Google",
      title: "Sending to Google…",
      description:
        "The change left NabaPresence. Google hasn’t confirmed it yet.",
      tone: "pending",
      toast: "info",
      live: false,
      glyph: "send",
      track: { stop: "sent" },
    },
    awaiting_confirmation: {
      label: "Sent, waiting for Google",
      title: "Sent, waiting for Google to confirm",
      description:
        "Google accepted the request but hasn’t shown the change yet. We’ll check again.",
      tone: "pending",
      toast: "info",
      live: false,
      glyph: "hourglass",
      track: { stop: "google", waitingOn: "Google" },
    },
    confirmed_applied: {
      label: "On Google",
      title: "Confirmed on Google",
      description:
        "Google confirmed the change. It can take a few minutes to show on Maps and Search.",
      tone: "healthy",
      toast: "success",
      live: true,
      glyph: "badge-check",
      track: { stop: "google", reached: true },
    },
    rejected: {
      label: "Rejected by Google",
      title: "Google refused it. Nothing changed on Google.",
      description: "Your saved copy is kept. Edit it before you send it again.",
      tone: "at-risk",
      toast: "error",
      live: false,
      glyph: "ban",
      track: { stop: "sent", failed: true },
    },
    failed: {
      label: "Failed: retry",
      title: "It didn’t go through. Nothing changed on Google.",
      description:
        "The request didn’t complete and nothing shows it reached Google. Your saved copy is kept.",
      tone: "at-risk",
      toast: "error",
      live: false,
      glyph: "triangle-alert",
      track: { stop: "sent", failed: true },
    },
    uncertain: {
      label: "Not confirmed: check Google",
      title: "We can’t tell whether Google applied it",
      description: "Check Google before trying again.",
      tone: "attention",
      toast: "warning",
      live: false,
      glyph: "circle-help",
      track: { stop: "sent" },
    },
    unsaved: {
      label: "Unsaved changes",
      title: "{n} unsaved changes",
      description: "Only in this browser tab. Save to keep them.",
      tone: "neutral",
      toast: "neutral",
      live: false,
      glyph: "circle-dashed",
      track: null,
    },
    blocked: {
      label: "Blocked by checks",
      title: "Blocked: fix the reply to publish",
      description:
        "A check failed, so publishing is blocked. Nothing has gone to Google.",
      tone: "at-risk",
      toast: "error",
      live: false,
      glyph: "octagon-x",
      track: { stop: "approved", failed: true },
    },
    changes: {
      label: "Sent back",
      title: "Sent back by {name}",
      description:
        "The approver sent it back to the author. Nothing has gone to Google.",
      tone: "attention",
      toast: "warning",
      live: false,
      glyph: "undo-2",
      track: { stop: "saved" },
    },
    approved: {
      label: "Approved, ready to send",
      title: "Approved by {name}. Publish when ready.",
      description: "Approved, but not sent yet. Nothing has gone to Google.",
      tone: "attention",
      toast: "info",
      live: false,
      glyph: "circle-check",
      track: { stop: "sent" },
    },
    retrying: {
      label: "Will retry at {time}",
      title: "Google is busy. We’ll retry at {time}.",
      description:
        "We’ll send it again automatically. Nothing has changed on Google yet.",
      tone: "pending",
      toast: "info",
      live: false,
      glyph: "refresh-cw",
      track: { stop: "sent" },
    },
    conflict: {
      label: "Changed on Google",
      title: "Google changed this since you saved it",
      description:
        "Google’s copy changed after you saved yours. Compare them before you send.",
      tone: "attention",
      toast: "warning",
      live: false,
      glyph: "git-compare",
      track: null,
    },
    withdrawn: {
      label: "Withdrawn",
      title: "Withdrawn. Nothing was sent to Google.",
      description: "The change was withdrawn before it was sent.",
      tone: "neutral",
      toast: "neutral",
      live: false,
      glyph: "circle-minus",
      track: null,
    },
    expired: {
      label: "Expired, not sent",
      title: "Expired. Nothing was sent to Google.",
      description: "The change waited too long and was not sent.",
      tone: "neutral",
      toast: "neutral",
      live: false,
      glyph: "circle-minus",
      track: null,
    },
    replaced: {
      label: "Replaced",
      title: "Replaced. Nothing was sent to Google.",
      description: "A newer change took its place before it was sent.",
      tone: "neutral",
      toast: "neutral",
      live: false,
      glyph: "circle-minus",
      track: null,
    },
  }

/**
 * A publish whose every Google step found Google already matching and sent
 * nothing. It is not an outcome: nothing was written, so nothing is
 * confirmed.
 */
export const NOTHING_TO_SEND_TITLE = "Nothing to send. Already matches Google"

/**
 * Fills a label or title's `{n}`, `{time}` and `{name}` slots. A slot with
 * no value is dropped with the words that only make sense beside it ("Sent
 * back by {name}" without a name reads "Sent back").
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
export function describeOutcome(outcome: PresentedState): OutcomePresentation {
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
 * Google write, "Post deleted", drawn neutral) or an outcome message, whose
 * toast kind then follows the outcome.
 */
export type SuccessToastCopy = string | OutcomeMessage

/** Resolves a success toast option to the toast fields. */
export function successToastFields(copy: SuccessToastCopy): {
  title: string
  description: string | undefined
  type: OutcomePresentation["toast"]
} {
  return typeof copy === "string"
    ? { title: copy, description: undefined, type: "neutral" }
    : outcomeToast(copy)
}
