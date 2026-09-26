import { CalendarDays, Repeat, Tag } from "lucide-react"

type Schedule = {
  startDate: string
  startTime: string
  endDate: string
  endTime: string
}

function formatWhen(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) return ""
  const [hours, minutes] = time ? time.split(":").map(Number) : []
  const value = new Date(year, month - 1, day, hours ?? 0, minutes ?? 0)
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    ...(time ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(value)
}

/**
 * What the post will look like where customers meet it (reference
 * `.gpost`): the title and dates for an event or offer, the text, and the
 * button's label in the link colour.
 *
 * It sits on the sheet's white surface, so it carries the hairline edge that
 * a white-on-white card needs.
 */
export function PostPreview({
  topicType,
  summary,
  eventTitle,
  schedule = null,
  actionLabel = "",
  recurrence = "",
}: {
  topicType: "STANDARD" | "EVENT" | "OFFER"
  summary: string
  eventTitle: string
  schedule?: Schedule | null
  actionLabel?: string
  /** "Repeats weekly on Fri", or "" for a one-off. */
  recurrence?: string
}) {
  const Icon = topicType === "OFFER" ? Tag : CalendarDays
  const when = schedule
    ? [
        formatWhen(schedule.startDate, schedule.startTime),
        formatWhen(schedule.endDate, schedule.endTime),
      ]
        .filter(Boolean)
        .join(" – ")
    : ""
  return (
    <figure className="m-0 flex flex-col overflow-hidden rounded-lg border border-line bg-surface">
      <figcaption className="border-b border-line bg-surface-alt px-3 py-2 font-mono text-caption tracking-[0.06em] text-ink-muted uppercase">
        Preview
      </figcaption>
      <div className="flex flex-col gap-2 p-4">
        {topicType !== "STANDARD" ? (
          <div className="flex flex-col gap-0.5">
            <p className="flex items-center gap-1.5 text-body font-semibold break-words text-ink">
              <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
              {eventTitle || (
                <span className="font-normal text-ink-muted">
                  {topicType === "OFFER" ? "Offer title" : "Event title"}
                </span>
              )}
            </p>
            <p className="font-mono text-caption text-ink-muted tabular-nums">
              {when || "Dates not set"}
            </p>
            {recurrence ? (
              <p className="flex items-center gap-1.5 text-caption text-ink-muted">
                <Repeat className="size-3.5 shrink-0" aria-hidden />
                {recurrence}
              </p>
            ) : null}
          </div>
        ) : null}
        <p
          className="text-ui break-words whitespace-pre-wrap text-ink"
          dir="auto"
        >
          {summary || (
            <span className="text-ink-muted">Your post text appears here.</span>
          )}
        </p>
        {actionLabel ? (
          <span className="text-ui font-semibold text-info-ink">
            {actionLabel}
          </span>
        ) : null}
      </div>
    </figure>
  )
}
