/**
 * How a publication schedule reads on the Posts tab (P08-R5): its badge, the
 * sentence that explains its reason, and the actions it allows. Kept apart
 * from the components so the rules (a missed slot is never retried, only
 * given a new time) are unit tested and shared by the schedules list and
 * the post card. Client-safe.
 */
import type {
  PublicationSchedule,
  ScheduleOccurrence,
} from "@/lib/contracts/publication-schedules"
import {
  resolveLocalSlot,
  SCHEDULE_MAX_LEAD_MS,
  SCHEDULE_MIN_LEAD_MS,
} from "@/lib/domain/publication-schedule"

/** Why a slot passed without publishing (0242); the way out is a new time. */
export const MISSED_REASONS: ReadonlySet<string> = new Set([
  "paused_when_due",
  "outside_dispatch_window",
])
/** Reasons whose only way out is choosing another time. */
const NEW_TIME_REASONS: ReadonlySet<string> = new Set([
  ...MISSED_REASONS,
  "slot_needs_new_time",
])

/** Statuses a schedule can still publish from, or be approved into. */
const OPEN_STATUSES: ReadonlySet<PublicationSchedule["status"]> = new Set([
  "awaiting_approval",
  "active",
  "paused",
  "blocked",
  "needs_review",
])

export const SCHEDULE_REASON: Record<string, string> = {
  approval_invalid:
    "The approval no longer holds (the approval policy or approver changed). Change the schedule and approve it again.",
  permission_revoked:
    "The approver or requester lost access. Change the schedule and have a current manager approve it.",
  feature_disabled:
    "Scheduled publishing was switched off for this workspace, so nothing was published. Change the schedule and approve it again once it is back.",
  recurring_disabled:
    "Repeating schedules are no longer available here, so nothing was published. Change it to a single publication, or cancel it.",
  recurring_quarantined:
    "Repeating schedules are no longer the default, so this one was stopped before it published again. Change it to a single publication, or cancel it.",
  slot_needs_new_time:
    "Its time was moved or picked automatically because of a clock change, which single publications no longer do, so it was stopped before it published. Choose a new time, or cancel it.",
  prior_occurrence_unresolved:
    "A publication was started but its result is not known yet. It is being checked and nothing is sent again; the schedule carries on once the result is known, or asks for a new time if nothing was sent.",
  prior_occurrence_unverified:
    "An earlier publication from before this update could not be confirmed either way. Check the location's posts on Google, then choose a new time or cancel it.",
  connection_changed:
    "The Google listing or connection changed after approval, so nothing was published. Change the schedule and approve it again.",
  paused_when_due:
    "The schedule was paused when its time came, so nothing was published and nothing will publish late. Choose a new time, or cancel it.",
  outside_dispatch_window:
    "It could not start within 5 minutes of its time, so nothing was published and nothing will publish late. Choose a new time, or cancel it.",
  source_changed:
    "The post was edited after this schedule was set up, so nothing publishes until the new text is approved. Approve it again, or change or cancel the schedule.",
  source_superseded:
    "The post was published another way or deleted, so this schedule will not publish it again.",
}

/** A subset of the status pill's tones (components/ui/status-pill.tsx). */
export type ScheduleBadge = {
  label: string
  tone: "ok" | "warn" | "bad" | "info" | "outline"
}

export function scheduleBadge(
  schedule: Pick<PublicationSchedule, "status" | "statusReason">
): ScheduleBadge {
  const missed = MISSED_REASONS.has(schedule.statusReason ?? "")
  switch (schedule.status) {
    case "awaiting_approval":
      return { label: "Awaiting approval", tone: "info" }
    case "active":
      return { label: "Active", tone: "ok" }
    case "paused":
      return { label: "Paused", tone: "outline" }
    case "blocked":
      return { label: "Blocked", tone: "bad" }
    case "needs_review":
      return missed
        ? { label: "Missed", tone: "warn" }
        : { label: "Needs review", tone: "warn" }
    case "cancelled":
      return { label: "Cancelled", tone: "outline" }
    case "completed":
      return { label: "Completed", tone: "outline" }
  }
}

/** The sentence under a schedule, or null when its status says enough. */
export function scheduleReasonText(
  schedule: Pick<PublicationSchedule, "status" | "statusReason" | "approvedBy">
): string | null {
  // Its draft was edited while it was paused (P08-R4): the new text has no
  // approval yet, so resuming asks for one rather than publishing.
  if (
    schedule.status === "paused" &&
    schedule.statusReason === "source_changed" &&
    !schedule.approvedBy
  )
    return "The post was edited while this schedule was paused. Resume it to ask for approval of the new text, or cancel it."
  return schedule.statusReason
    ? (SCHEDULE_REASON[schedule.statusReason] ?? null)
    : null
}

export type ScheduleActions = {
  review: boolean
  pause: boolean
  /** The resume button's label, or null when resuming is not offered. */
  resume: string | null
  /** The change button's label, or null when changing is not offered. */
  change: string | null
  cancel: boolean
}

/**
 * What a viewer may do with a schedule. A missed slot is never resumed or
 * retried: nothing publishes late, so the only ways out are a new time or a
 * cancel. With the feature off (`enabled` false) only pause and cancel stay,
 * so an existing schedule can always be stopped.
 */
export function scheduleActions(
  schedule: Pick<PublicationSchedule, "status" | "statusReason" | "approvedBy">,
  viewer: { manager: boolean; editor: boolean; enabled: boolean }
): ScheduleActions {
  const open = OPEN_STATUSES.has(schedule.status)
  const reason = schedule.statusReason ?? ""
  const missed = MISSED_REASONS.has(reason)
  return {
    review:
      schedule.status === "awaiting_approval" &&
      viewer.manager &&
      viewer.enabled,
    pause: schedule.status === "active" && viewer.manager,
    resume:
      schedule.status === "paused" &&
      !missed &&
      viewer.manager &&
      viewer.enabled
        ? schedule.approvedBy
          ? "Resume"
          : "Resume and request approval"
        : null,
    change:
      open && viewer.editor && viewer.enabled
        ? NEW_TIME_REASONS.has(reason)
          ? "Choose a new time"
          : "Change"
        : null,
    cancel: open && viewer.manager,
  }
}

/** Whether a schedule still holds its post for a one-time publication. */
export function liveOnceSchedule(
  schedule: Pick<PublicationSchedule, "status" | "rule">
) {
  return (
    schedule.rule.frequency === "once" &&
    ["awaiting_approval", "active", "paused", "blocked"].includes(
      schedule.status
    )
  )
}

/** The calendar's sentence for an occurrence that did not publish. */
export function occurrenceReasonText(
  occurrence: Pick<ScheduleOccurrence, "status" | "statusReason">
): string | null {
  if (occurrence.status === "missed")
    return occurrence.statusReason === "paused_when_due"
      ? "Paused when due: nothing published. Choose a new time on the listing."
      : "Not started within 5 minutes: nothing published. Choose a new time on the listing."
  if (occurrence.status === "ambiguous")
    return "Result being checked; nothing is sent again."
  if (occurrence.status === "rejected") return "Google did not accept it."
  return null
}

/**
 * A suggested local date and time is used only if it is still a slot a
 * one-time schedule can take, resolved in the sheet's zone: at least the
 * minimum lead after the sheet opened and not beyond the maximum. A time
 * already passed (or too close) falls back to the default.
 */
export function usableSuggestion(
  suggested: { startDate: string; localTime: string } | undefined,
  zone: string,
  openedAt: number
) {
  if (!suggested) return null
  const slot = resolveLocalSlot(suggested.startDate, suggested.localTime, zone)
  if (slot.kind === "nonexistent") return null
  const instants =
    slot.kind === "ok"
      ? [slot.instant]
      : slot.choices.map((choice) => choice.instant)
  return instants.some((instant) => {
    const lead = instant.getTime() - openedAt
    return lead >= SCHEDULE_MIN_LEAD_MS && lead <= SCHEDULE_MAX_LEAD_MS
  })
    ? suggested
    : null
}
