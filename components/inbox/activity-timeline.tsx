"use client"

import { useId, useState } from "react"
import {
  ChevronRightIcon,
  CircleDotIcon,
  CircleCheckIcon,
  CloudUploadIcon,
  FileTextIcon,
  RefreshCwIcon,
  SendHorizonalIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
  Trash2Icon,
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
  neutral: "bg-muted text-muted-foreground",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-foreground",
  destructive: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-foreground",
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
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-3">
      <h3 id="activity-heading" className="text-ui font-semibold">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            className="flex w-full items-center gap-1.5 rounded-(--nr-radius-control) font-semibold focus-visible:ring-3 focus-visible:ring-ring/30 focus-visible:outline-none"
          >
            <ChevronRightIcon
              aria-hidden
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-90"
              )}
            />
            Activity
            {timeline.length > 0 ? (
              <span className="font-normal text-muted-foreground">
                ({timeline.length})
              </span>
            ) : null}
          </button>
        ) : (
          "Activity"
        )}
      </h3>
      <div id={panelId} hidden={!showPanel}>
        {timeline.length === 0 ? (
          <p className="text-caption text-muted-foreground">No activity yet.</p>
        ) : (
          <ol className="flex flex-col">
            {timeline.map((event, index) => {
              const { Icon, tone } = eventVisual(event.action)
              const isLast = index === timeline.length - 1
              return (
                <li
                  key={`${event.action}-${event.createdAt}-${event.actorName ?? ""}`}
                  className="relative flex gap-3 pb-4 last:pb-0"
                >
                  {/* Connector: runs from the bottom of this chip to the next
                      one, centred on the 28px (size-7) chip. */}
                  {isLast ? null : (
                    <span
                      aria-hidden
                      className="absolute top-8 bottom-0 left-[13px] w-px bg-border/70"
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "relative flex size-7 shrink-0 items-center justify-center rounded-full",
                      TONE_CHIP[tone]
                    )}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-ui font-medium">
                        {humaniseAction(event.action)}
                      </span>
                      <time
                        dateTime={event.createdAt}
                        className="shrink-0 text-caption text-muted-foreground tabular-nums"
                      >
                        {formatDateTime(event.createdAt, timezone)}
                      </time>
                    </div>
                    {event.actorName ? (
                      <span className="text-caption text-muted-foreground">
                        {event.actorName}
                      </span>
                    ) : null}
                    {event.metadataSummary ? (
                      <span className="text-caption text-muted-foreground/80">
                        {event.metadataSummary}
                      </span>
                    ) : null}
                  </div>
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
