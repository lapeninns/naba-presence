import { CalendarDays, Tag } from "lucide-react"

/**
 * What the post will look like where customers meet it.
 *
 * The composer used to be three form controls with no sense of the result, so
 * the first time anyone saw a post rendered was on Google, after it published.
 *
 * It sits on the sheet's white surface, so it carries the hairline edge that
 * a white-on-white card needs.
 */
export function PostPreview({
  topicType,
  summary,
  eventTitle,
}: {
  topicType: "STANDARD" | "EVENT" | "OFFER"
  summary: string
  eventTitle: string
}) {
  const Icon = topicType === "OFFER" ? Tag : CalendarDays
  return (
    <figure className="flex flex-col overflow-hidden rounded-(--np-radius-card) bg-surface hairline">
      <figcaption className="border-b border-line-subtle px-3 py-2 text-caption font-medium text-ink-muted">
        Preview
      </figcaption>
      <div className="flex flex-col gap-2 p-3">
        {topicType !== "STANDARD" ? (
          <p className="flex items-center gap-1.5 text-body font-semibold text-ink">
            <Icon
              className="size-4 shrink-0 text-ink-muted"
              strokeWidth={1.75}
              aria-hidden
            />
            {eventTitle || (
              <span className="font-normal text-ink-faint">
                {topicType === "OFFER" ? "Offer title" : "Event title"}
              </span>
            )}
          </p>
        ) : null}
        <p className="text-body whitespace-pre-wrap text-ink" dir="auto">
          {summary || (
            <span className="text-ink-faint">Your post text appears here.</span>
          )}
        </p>
      </div>
    </figure>
  )
}
