"use client"

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

function ActivityTimeline({
  timeline,
  timezone,
}: {
  timeline: {
    action: string
    createdAt: string
    actorName: string | null
    metadataSummary: string | null
  }[]
  timezone: string
}) {
  return (
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2.5">
      <h3 id="activity-heading" className="text-ui font-semibold">
        Activity
      </h3>
      {timeline.length === 0 ? (
        <p className="text-caption text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l border-border/70 pl-4">
          {timeline.map((event, index) => (
            <li
              key={`${event.action}-${event.createdAt}-${event.actorName ?? ""}`}
              className="relative flex flex-col gap-0.5 text-caption"
            >
              {/* Rail node: the newest event gets the primary dot, the rest
                  recede — currency is the only signal worth encoding. */}
              <span
                aria-hidden
                className={cn(
                  "absolute top-[5px] -left-[21px] size-2 rounded-full ring-2 ring-card",
                  index === 0 ? "bg-primary" : "bg-border"
                )}
              />
              <span className="font-medium">{humaniseAction(event.action)}</span>
              <span className="text-muted-foreground">
                {event.actorName ? `${event.actorName} · ` : ""}
                {formatDateTime(event.createdAt, timezone)}
              </span>
              {event.metadataSummary ? (
                <span className="text-muted-foreground">
                  {event.metadataSummary}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export { ActivityTimeline, humaniseAction }
