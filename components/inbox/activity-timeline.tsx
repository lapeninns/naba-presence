"use client"

import { HistoryIcon } from "lucide-react"

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
 * Everything that happened to a review and its reply, newest last. Drawn in
 * the History dialog (review-detail.tsx), which owns the scrolling.
 */
function ActivityTimeline({
  timeline,
  timezone,
}: {
  timeline: TimelineEvent[]
  timezone: string
}) {
  const eventCountLabel = `${timeline.length} ${
    timeline.length === 1 ? "event" : "events"
  }`

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      <h3 id="activity-heading" className="flex h-8 items-center gap-2">
        <HistoryIcon
          aria-hidden
          strokeWidth={1.75}
          className="size-4 shrink-0 text-ink-muted"
        />
        <span className="text-ui font-semibold text-ink">Activity</span>
        <span className="text-caption font-normal text-ink-muted tabular-nums">
          {eventCountLabel}
        </span>
      </h3>
      {timeline.length === 0 ? (
        <div className="rounded-(--np-radius-control) bg-surface-sunken px-3 py-3">
          <p className="text-ui font-medium text-ink">No activity yet</p>
          <p className="mt-0.5 text-caption text-ink-muted">
            Draft, verification and publishing events will appear here.
          </p>
        </div>
      ) : (
        <Timeline
          aria-label="Activity events"
          reveal
          className="pt-1"
          entries={timeline.map((event, index) => ({
            id: `${event.action}-${event.createdAt}-${index}`,
            title: humaniseAction(event.action),
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
      )}
    </section>
  )
}

export { ActivityTimeline, humaniseAction }
