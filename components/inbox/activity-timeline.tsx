"use client"

import { formatDateTime } from "@/lib/format"

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
    <section aria-labelledby="activity-heading" className="flex flex-col gap-2">
      <h3 id="activity-heading" className="text-ui font-semibold">
        Activity
      </h3>
      {timeline.length === 0 ? (
        <p className="text-caption text-muted-foreground">No activity yet.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {timeline.map((event, index) => (
            <li key={index} className="flex flex-col gap-0.5 text-caption">
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
