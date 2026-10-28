"use client"

import { Timeline, type TimelineTone } from "@/components/ui/timeline"
import { formatDateTime } from "@/lib/format"

// Humanise the audit action enum into GB-English sentence case (spec §7 "no
// internal jargon"): "review.draft.generated" -> "Draft generated".
function humaniseAction(action: string): string {
  const trimmed = action.replace(/^review\./, "").replace(/_/g, " ")
  const words = trimmed.split(".").join(" ")
  const sentence = words.charAt(0).toUpperCase() + words.slice(1)
  return sentence
}

// What each audit action means to the people who reply, in their words
// rather than the audit schema's. An action not listed falls back to
// `humaniseAction`, so a new one still reads as words. The assignment row
// cannot name who or whether it was cleared: the server keeps that metadata
// out of the timeline.
const EVENT_LABEL: Record<string, string> = {
  "review.draft.generated": "Draft generated",
  "review.draft.edited": "Draft saved",
  "review.draft.verified": "Draft checked",
  "review.draft.verification_completed": "Draft checked",
  "review.approval.requested": "Sent for approval",
  "review.approval.approved": "Reply approved",
  "review.approval.rejected": "Sent back",
  "review.reply.publish_requested": "Reply sent to Google",
  "review.reply.published": "Reply published",
  "review.reply.publish_failed": "Reply could not be sent",
  "review.reply.delete_requested": "Deletion sent to Google",
  "review.reply.deleted": "Reply deleted",
  "review.reply.delete_failed": "Reply could not be deleted",
  "review.triaged": "Marked as no reply needed",
  "review.untriaged": "Put back in Needs reply",
  "review.assigned": "Assignment changed",
  "review.provider_deleted": "Removed from Google",
}

function eventLabel(action: string): string {
  return EVENT_LABEL[action] ?? humaniseAction(action)
}

type TimelineEvent = {
  action: string
  createdAt: string
  actorName: string | null
  metadataSummary: string | null
}

// Tone is derived from the action verb, not the workflow state: the feed
// answers "what happened here?" at a glance. It colours the rail dot only;
// the words carry the meaning.
function eventTone(action: string): TimelineTone {
  const a = action.toLowerCase()
  if (a.includes("reject") || a.includes("delete")) return "danger"
  if (a.includes("escalat")) return "warning"
  if (a.includes("verif")) return "info"
  if (a.includes("publish") && a.includes("request")) return "info"
  if (a.includes("publish")) return "success"
  if (a.includes("approv")) return "success"
  return "neutral"
}

// The server's placeholder when an audit row carries metadata it chose not
// to summarise; it says nothing, so it is not shown.
const NO_SUMMARY = "Additional audit details recorded"

/**
 * Everything that happened to a review and its reply, newest first (the
 * server reads the audit rows `created_at desc`). Drawn in the History dialog
 * (review-detail.tsx), which owns the title and the scrolling.
 */
function ActivityTimeline({
  timeline,
  timezone,
}: {
  timeline: TimelineEvent[]
  timezone: string
}) {
  return (
    <div className="flex flex-col gap-2">
      {timeline.length === 0 ? (
        <div className="rounded-(--np-radius-control) bg-surface-sunken px-3 py-3">
          <p className="text-ui font-medium text-ink">No activity yet</p>
          <p className="mt-0.5 text-caption text-ink-muted">
            Drafts, approvals, publishing and assignments will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* The dialog's title is the one heading; this only says how many
              and in which order. */}
          <p className="text-caption text-ink-muted tabular-nums">
            {timeline.length} {timeline.length === 1 ? "event" : "events"},
            newest first
          </p>
          <Timeline
            aria-label="Activity events"
            reveal
            className="pt-1"
            entries={timeline.map((event, index) => ({
              id: `${event.action}-${event.createdAt}-${index}`,
              title: eventLabel(event.action),
              meta: event.actorName
                ? `${formatDateTime(event.createdAt, timezone)} · ${event.actorName}`
                : formatDateTime(event.createdAt, timezone),
              detail:
                event.metadataSummary && event.metadataSummary !== NO_SUMMARY
                  ? event.metadataSummary
                  : undefined,
              tone: eventTone(event.action),
            }))}
          />
        </>
      )}
    </div>
  )
}

export { ActivityTimeline, humaniseAction }
