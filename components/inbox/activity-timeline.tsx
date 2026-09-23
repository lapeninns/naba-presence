"use client"

import { useId, useState } from "react"
import { ChevronDownIcon, HistoryIcon } from "lucide-react"

import { Timeline, type TimelineTone } from "@/components/ui/timeline"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

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

function ActivityTimeline({
  timeline,
  timezone,
  collapsible = false,
}: {
  timeline: TimelineEvent[]
  timezone: string
  // Collapsed by default when true: the heading becomes the toggle and the
  // event list stays out of the reply workflow until asked for.
  collapsible?: boolean
}) {
  const [open, setOpen] = useState(false)
  // The panel stays mounted (toggled via `hidden`) so aria-controls never
  // points at a missing id.
  const panelId = useId()
  const showPanel = !collapsible || open
  const eventCountLabel = `${timeline.length} ${
    timeline.length === 1 ? "event" : "events"
  }`

  const headingContent = (
    <>
      <HistoryIcon
        aria-hidden
        strokeWidth={1.75}
        className="size-4 shrink-0 text-ink-muted"
      />
      <span className="text-ui font-semibold text-ink">Activity</span>
      <span className="text-caption font-normal text-ink-muted tabular-nums">
        {eventCountLabel}
      </span>
    </>
  )

  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      {collapsible ? (
        <h3 id="activity-heading">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`Activity, ${eventCountLabel}`}
            onClick={() => setOpen((value) => !value)}
            className="-mx-2 flex h-8 w-[calc(100%+1rem)] items-center gap-2 rounded-(--np-radius-control) px-2 text-left focus-halo transition duration-(--np-duration-fast) ease-spring-snappy hover:bg-(--np-hover-bg) focus-visible:outline-none active:bg-fill-tertiary"
          >
            {headingContent}
            <ChevronDownIcon
              aria-hidden
              strokeWidth={1.75}
              className={cn(
                "ml-auto size-4 shrink-0 text-ink-muted transition-transform duration-(--np-duration-fast) ease-spring-snappy",
                !open && "-rotate-90"
              )}
            />
          </button>
        </h3>
      ) : (
        <h3 id="activity-heading" className="flex h-8 items-center gap-2">
          {headingContent}
        </h3>
      )}
      <div id={panelId} hidden={!showPanel}>
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
      </div>
    </section>
  )
}

export { ActivityTimeline, humaniseAction }
