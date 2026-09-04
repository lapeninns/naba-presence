import { CalendarDays, Tag } from "lucide-react"

/**
 * What the post will look like where customers meet it.
 *
 * The composer used to be three form controls with no sense of the result, so
 * the first time anyone saw a post rendered was on Google, after it published.
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
    <figure className="flex flex-col gap-0 overflow-hidden rounded-(--np-radius-card) border border-line bg-surface">
      <figcaption className="border-b border-line-subtle bg-surface-sunken px-3 py-2 text-caption text-ink-muted">
        Preview
      </figcaption>
      <div className="flex flex-col gap-2 p-3">
        {topicType !== "STANDARD" ? (
          <p className="flex items-center gap-1.5 text-title font-medium">
            <Icon className="size-4 shrink-0 text-ink-muted" aria-hidden />
            {eventTitle || (
              <span className="text-ink-faint">
                {topicType === "OFFER" ? "Offer title" : "Event title"}
              </span>
            )}
          </p>
        ) : null}
        <p className="text-body whitespace-pre-wrap" dir="auto">
          {summary || (
            <span className="text-ink-faint">
              Your post text appears here.
            </span>
          )}
        </p>
      </div>
    </figure>
  )
}
