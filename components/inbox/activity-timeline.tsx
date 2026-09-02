"use client"

import { useId, useState } from "react"
import {
  ChevronDownIcon,
  ClockIcon,
  CircleDotIcon,
  CircleCheckIcon,
  CloudUploadIcon,
  FileTextIcon,
  HistoryIcon,
  RefreshCwIcon,
  SendHorizonalIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  Trash2Icon,
  UserIcon,
} from "lucide-react"

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

type EventTone = "neutral" | "success" | "warning" | "destructive" | "info"

// Category is derived from the action verb, not the workflow state: the feed
// answers "what happened here?" at a glance. Tone pairs mirror the Badge
// variants' measured AA choices (warning/info keep text-foreground on tint).
function eventVisual(action: string): {
  Icon: typeof CircleDotIcon
  tone: EventTone
} {
  const a = action.toLowerCase()
  if (a.includes("reject") || a.includes("delete")) {
    return { Icon: Trash2Icon, tone: "destructive" }
  }
  if (a.includes("escalat")) return { Icon: TriangleAlertIcon, tone: "warning" }
  if (a.includes("verif")) return { Icon: ShieldCheckIcon, tone: "info" }
  if (a.includes("publish") && a.includes("request")) {
    return { Icon: SendHorizonalIcon, tone: "info" }
  }
  if (a.includes("publish")) return { Icon: CloudUploadIcon, tone: "success" }
  if (a.includes("approv")) return { Icon: CircleCheckIcon, tone: "success" }
  if (a.includes("sync")) return { Icon: RefreshCwIcon, tone: "neutral" }
  if (a.includes("draft") || a.includes("generat")) {
    return { Icon: FileTextIcon, tone: "neutral" }
  }
  return { Icon: CircleDotIcon, tone: "neutral" }
}

const TONE_CHIP: Record<EventTone, string> = {
  neutral: "bg-muted text-muted-foreground ring-border/60",
  success: "bg-success/10 text-success ring-success/20",
  warning: "bg-warning/15 text-foreground ring-warning/25",
  destructive: "bg-destructive/10 text-destructive ring-destructive/20",
  info: "bg-info/10 text-foreground ring-info/20",
}

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

  return (
    <section
      aria-labelledby="activity-heading"
      className="overflow-hidden rounded-(--nr-radius-field) border border-border/70 bg-background"
    >
      {collapsible ? (
        <h3 id="activity-heading">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={`Activity, ${eventCountLabel}`}
            onClick={() => setOpen((value) => !value)}
            className="group flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none focus-visible:ring-inset sm:px-4"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-(--nr-radius-control) bg-muted text-muted-foreground ring-1 ring-border/60 transition-colors ring-inset group-hover:text-foreground">
              <HistoryIcon aria-hidden className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-ui font-semibold">Activity</span>
                <span className="rounded-(--nr-radius-pill) bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
                  {eventCountLabel}
                </span>
              </span>
              <span className="mt-0.5 hidden text-caption font-normal text-muted-foreground min-[360px]:block">
                Review history and audit details
              </span>
            </span>
            <span className="inline-flex shrink-0 items-center gap-1.5 text-caption font-medium text-muted-foreground">
              <span className="hidden sm:inline">{open ? "Hide" : "Show"}</span>
              <ChevronDownIcon
                aria-hidden
                className={cn(
                  "size-4 transition-transform duration-(--nr-duration-fast)",
                  !open && "-rotate-90"
                )}
              />
            </span>
          </button>
        </h3>
      ) : (
        <h3
          id="activity-heading"
          className="flex items-center gap-3 px-3 py-3 sm:px-4"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-(--nr-radius-control) bg-muted text-muted-foreground ring-1 ring-border/60 ring-inset">
            <HistoryIcon aria-hidden className="size-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-ui font-semibold">Activity</span>
              <span className="rounded-(--nr-radius-pill) bg-muted px-2 py-0.5 text-caption font-medium text-muted-foreground">
                {eventCountLabel}
              </span>
            </span>
            <span className="mt-0.5 hidden text-caption font-normal text-muted-foreground min-[360px]:block">
              Review history and audit details
            </span>
          </span>
        </h3>
      )}
      <div
        id={panelId}
        hidden={!showPanel}
        className="@container/activity-panel border-t border-border/60 bg-muted/15"
      >
        {timeline.length === 0 ? (
          <div className="flex items-start gap-3 px-3 py-4 sm:px-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <CircleDotIcon aria-hidden className="size-4" />
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="text-ui font-medium">No activity yet</p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                New draft, verification, and publishing events will appear here.
              </p>
            </div>
          </div>
        ) : (
          <ol
            aria-label="Activity events"
            className="grid snap-x snap-mandatory [scrollbar-width:thin] auto-cols-[12rem] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain scroll-smooth px-3 py-3 sm:px-4 sm:py-4 @min-[32rem]/activity-panel:snap-none @min-[32rem]/activity-panel:auto-cols-auto @min-[32rem]/activity-panel:grid-flow-row @min-[32rem]/activity-panel:grid-cols-4 @min-[32rem]/activity-panel:gap-2 @min-[32rem]/activity-panel:overflow-visible @min-[52rem]/activity-panel:gap-3"
          >
            {timeline.map((event) => {
              const { Icon, tone } = eventVisual(event.action)
              return (
                <li
                  key={`${event.action}-${event.createdAt}-${event.actorName ?? ""}`}
                  className="min-w-0 snap-start rounded-(--nr-radius-control) border border-border/70 bg-background p-3 shadow-sm @min-[32rem]/activity-panel:p-2.5 @min-[52rem]/activity-panel:p-3"
                >
                  <div className="flex min-w-0 items-start gap-3 @min-[32rem]/activity-panel:flex-col @min-[32rem]/activity-panel:gap-2 @min-[52rem]/activity-panel:flex-row @min-[52rem]/activity-panel:gap-3">
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-9 shrink-0 items-center justify-center rounded-(--nr-radius-control) ring-1 ring-inset @min-[32rem]/activity-panel:size-8 @min-[52rem]/activity-panel:size-9",
                        TONE_CHIP[tone]
                      )}
                    >
                      <Icon className="size-4" />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <span className="min-w-0 text-body font-semibold break-words @min-[32rem]/activity-panel:text-ui @min-[52rem]/activity-panel:text-body">
                        {humaniseAction(event.action)}
                      </span>
                    </div>
                  </div>
                  <time
                    dateTime={event.createdAt}
                    className="mt-3 inline-flex items-center gap-1.5 text-caption text-muted-foreground tabular-nums @min-[32rem]/activity-panel:mt-2 @min-[52rem]/activity-panel:mt-3"
                  >
                    <ClockIcon aria-hidden className="size-3.5 shrink-0" />
                    {formatDateTime(event.createdAt, timezone)}
                  </time>
                  {event.actorName ? (
                    <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-caption text-muted-foreground @min-[32rem]/activity-panel:sr-only @min-[52rem]/activity-panel:not-sr-only @min-[52rem]/activity-panel:flex">
                      <UserIcon aria-hidden className="size-3.5 shrink-0" />
                      <span className="min-w-0 break-words">
                        {event.actorName}
                      </span>
                    </span>
                  ) : null}
                  {event.metadataSummary &&
                  event.metadataSummary !==
                    "Additional audit details recorded" ? (
                    <p className="mt-2 min-w-0 border-t border-border/50 pt-2 text-caption break-words text-muted-foreground/80 @min-[32rem]/activity-panel:sr-only @min-[52rem]/activity-panel:not-sr-only @min-[52rem]/activity-panel:block">
                      {event.metadataSummary}
                    </p>
                  ) : null}
                </li>
              )
            })}
          </ol>
        )}
      </div>
    </section>
  )
}

export { ActivityTimeline, humaniseAction }
