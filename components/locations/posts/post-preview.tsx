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
  imageUrl = null,
}: {
  topicType: "STANDARD" | "EVENT" | "OFFER"
  summary: string
  eventTitle: string
  schedule?: Schedule | null
  actionLabel?: string
  /** "Repeats weekly on Fri", or "" for a one-off. */
  recurrence?: string
  /** The post's first photo, as Google will show it. */
  imageUrl?: string | null
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
    <figure className="m-0 flex flex-col overflow-hidden rounded-(--np-radius-card) border border-line-subtle bg-surface">
      <figcaption className="border-b border-line-subtle bg-surface-alt px-3 py-2 text-caption font-medium text-ink-muted">
        Preview
      </figcaption>
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a remote Google/merchant URL shown as-is
        <img
          src={imageUrl}
          alt="The post's photo"
          className="aspect-[4/3] w-full bg-surface-alt object-cover"
        />
      ) : null}
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
            <p className="text-caption text-ink-muted tabular-nums">
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
