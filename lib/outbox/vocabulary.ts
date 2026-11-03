/**
 * The Outbox's states and groups (DIRECTION §6.1, §7.1), as an adapter over
 * the one presentation map, lib/editors/outcome.ts `OUTCOME_PRESENTATION`.
 * This file owns no words of its own for a state: each Outbox state names
 * the presented state whose label, tone and glyph it shows, so a label
 * change there reaches the Outbox without an edit here.
 *
 * It does own what is only the Outbox's: the four groups, which state sits
 * in which, and the recovery verb a row's link carries (the verbs are the
 * DIRECTION §6.1 action words; the link opens the screen that acts, the
 * Outbox itself never sends).
 *
 * The rule the states carry: only `live` reads "On Google", and the read
 * model (lib/server/outbox.ts) derives it from confirmed state alone.
 *
 * Pure and client-safe.
 */
import {
  describeOutcome,
  statusText,
  type OutcomePresentation,
  type PresentedState,
} from "@/lib/editors/outcome"

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

/**
 * Each Outbox state's key in OUTCOME_PRESENTATION (DIRECTION §6.1 keys on
 * the left, the presentation map's on the right).
 */
export const OUTBOX_PRESENTED_STATE: Record<OutboxState, PresentedState> = {
  approval: "awaiting_approval",
  changes: "changes",
  approved: "approved",
  sending: "sent",
  retrying: "retrying",
  waiting: "awaiting_confirmation",
  uncertain: "uncertain",
  rejected: "rejected",
  failed: "failed",
  live: "confirmed_applied",
}

const GROUP_OF: Record<OutboxState, OutboxGroupKey> = {
  approval: "person",
  changes: "person",
  approved: "person",
  sending: "google",
  retrying: "google",
  waiting: "google",
  uncertain: "google",
  rejected: "failed",
  failed: "failed",
  live: "live",
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
    note: "Open each one to recover it",
  },
  {
    key: "live",
    title: "Confirmed today",
    note: "Confirmed on Google in the last 24 hours",
  },
]

export function outboxGroupOf(state: OutboxState): OutboxGroupKey {
  return GROUP_OF[state]
}

/** The group's place in reading order: the list sorts by it first. */
export function outboxGroupRank(group: OutboxGroupKey): number {
  return OUTBOX_GROUP_KEYS.indexOf(group)
}

export type OutboxStatus = Pick<
  OutcomePresentation,
  "tone" | "glyph" | "description"
> & {
  key: OutboxState
  /** The pill label, slots filled. */
  label: string
}

/**
 * The pill words, tone and glyph for one state, read from the shared
 * presentation map. `time` fills "Will retry at {time}" (format it in the
 * viewer's zone first); without it the shared template reads "Will retry
 * later".
 */
export function outboxStatus(
  state: OutboxState,
  values: { time?: string } = {}
): OutboxStatus {
  const presentation = describeOutcome(OUTBOX_PRESENTED_STATE[state])
  return {
    key: state,
    label: statusText(presentation.label, values),
    tone: presentation.tone,
    glyph: presentation.glyph,
    description: presentation.description,
  }
}

export type OutboxRecoveryKind = "reply" | "listing_change" | "post" | "bulk"

/**
 * The verb on a row's link: what the owning screen lets a person do next
 * (DIRECTION §6.1 "Actions"). Rows Google holds read "View progress": there
 * is nothing to do but wait, and the link only shows where it stands.
 */
export function outboxRecoveryVerb(
  kind: OutboxRecoveryKind,
  state: OutboxState
): string {
  switch (state) {
    case "approval":
      return "Review approval"
    case "approved":
      return "Review and publish"
    case "changes":
    case "rejected":
      return kind === "reply" ? "Edit reply" : "Edit and send again"
    case "failed":
      return "Retry sending"
    case "uncertain":
      return "Check Google"
    case "sending":
    case "retrying":
    case "waiting":
      return "View progress"
    case "live":
      return "View"
  }
}
