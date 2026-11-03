/**
 * The Outbox's status words: DIRECTION §6.1, the rows an Outbox can show.
 *
 * This is a local adapter over the one table in DIRECTION §6.1, kept to the
 * keys the Outbox reads (it never shows `unsaved`, `draft`, `blocked`,
 * `needsReply`, `conflict` or the withdrawn family). When the central status
 * vocabulary lands, `outboxStatus` should read from it instead and this
 * table should go; the Outbox's components only call `outboxStatus` and
 * `OUTBOX_GROUPS`, so nothing else changes.
 *
 * The rule the labels carry: only `live` may say "On Google", and it is only
 * ever derived from confirmed state (lib/server/outbox.ts). Queued, sent and
 * accepted work says "Sending to Google" or "Sent, waiting for Google".
 *
 * Pure and client-safe.
 */

export const OUTBOX_STATES = [
  "approval",
  "changes",
  "approved",
  "sending",
  "retrying",
  "waiting",
  "uncertain",
  "rejected",
  "failed",
  "live",
] as const
export type OutboxState = (typeof OUTBOX_STATES)[number]

export const OUTBOX_GROUP_KEYS = ["person", "google", "failed", "live"] as const
export type OutboxGroupKey = (typeof OUTBOX_GROUP_KEYS)[number]

/** Who acts next, in the status-tone names (lib/ui/status-tone.ts). */
export type OutboxTone = "attention" | "pending" | "healthy" | "at-risk"

/** The lucide glyph per state (DIRECTION §6.1 "Glyph"). */
export type OutboxGlyph =
  | "user-check"
  | "undo-2"
  | "circle-check"
  | "send"
  | "refresh-cw"
  | "hourglass"
  | "circle-help"
  | "ban"
  | "triangle-alert"
  | "badge-check"

type StateWords = {
  /** The pill label (exact). `retrying` fills its time in `outboxStatus`. */
  label: string
  tone: OutboxTone
  glyph: OutboxGlyph
  group: OutboxGroupKey
}

const STATES: Record<OutboxState, StateWords> = {
  approval: {
    label: "Awaiting approval",
    tone: "attention",
    glyph: "user-check",
    group: "person",
  },
  changes: {
    label: "Sent back",
    tone: "attention",
    glyph: "undo-2",
    group: "person",
  },
  approved: {
    label: "Approved, ready to send",
    tone: "attention",
    glyph: "circle-check",
    group: "person",
  },
  sending: {
    label: "Sending to Google",
    tone: "pending",
    glyph: "send",
    group: "google",
  },
  retrying: {
    label: "Will retry at HH:MM",
    tone: "pending",
    glyph: "refresh-cw",
    group: "google",
  },
  waiting: {
    label: "Sent, waiting for Google",
    tone: "pending",
    glyph: "hourglass",
    group: "google",
  },
  uncertain: {
    label: "Not confirmed: check Google",
    tone: "attention",
    glyph: "circle-help",
    group: "google",
  },
  rejected: {
    label: "Rejected by Google",
    tone: "at-risk",
    glyph: "ban",
    group: "failed",
  },
  failed: {
    label: "Failed: retry",
    tone: "at-risk",
    glyph: "triangle-alert",
    group: "failed",
  },
  live: {
    label: "On Google",
    tone: "healthy",
    glyph: "badge-check",
    group: "live",
  },
}

/** The four groups, in reading order, with their titles (DIRECTION §6.1). */
export const OUTBOX_GROUPS: readonly {
  key: OutboxGroupKey
  title: string
  /** One line under the title: whose move it is. */
  note: string
}[] = [
  {
    key: "person",
    title: "Waiting for a person",
    note: "Approvals, and changes sent back to their author",
  },
  {
    key: "google",
    title: "With Google",
    note: "Sent, and not yet confirmed on Google",
  },
  {
    key: "failed",
    title: "Failed",
    note: "Nothing changed on Google. Open each one to recover",
  },
  {
    key: "live",
    title: "Confirmed today",
    note: "Confirmed on Google in the last 24 hours",
  },
]

/** "14:05" in the viewer's time zone, for "Will retry at HH:MM". */
function clockTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(new Date(iso))
}

export type OutboxStatus = StateWords & { key: OutboxState }

/**
 * The words, tone, glyph and group for one state. `retryAt` fills the
 * retry time; without it a retrying row reads as sending, since an
 * unknown retry time is still a send in progress.
 */
export function outboxStatus(
  state: OutboxState,
  options: { retryAt?: string | null; timeZone?: string } = {}
): OutboxStatus {
  if (state === "retrying") {
    if (!options.retryAt) return { ...STATES.sending, key: "sending" }
    return {
      ...STATES.retrying,
      key: state,
      label: `Will retry at ${clockTime(options.retryAt, options.timeZone)}`,
    }
  }
  return { ...STATES[state], key: state }
}

export function outboxGroupOf(state: OutboxState): OutboxGroupKey {
  return STATES[state].group
}
