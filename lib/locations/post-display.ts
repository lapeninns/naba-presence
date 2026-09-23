/**
 * How a Google post reads on screen: its status in words, its headline, the
 * dates and button it carries. Presentation only — every value comes from
 * the post row the API returns (`lib/contracts/location-posts.ts`), whose
 * `event`, `offer`, `callToAction` and `media` are Google's own LocalPost
 * shapes passed through unchanged.
 */
import type {
  LocalPostActionType,
  LocalPostTopicType,
  PostRow,
} from "@/lib/contracts/location-posts"

export type PostTone = "neutral" | "info" | "ok" | "warn" | "bad"

export const POST_TOPIC_LABEL: Record<LocalPostTopicType, string> = {
  STANDARD: "Update",
  EVENT: "Event",
  OFFER: "Offer",
}

export const POST_ACTION_LABEL: Record<LocalPostActionType, string> = {
  BOOK: "Book",
  ORDER: "Order online",
  SHOP: "Buy",
  LEARN_MORE: "Learn more",
  SIGN_UP: "Sign up",
  CALL: "Call now",
}

/**
 * The post's state in words. "Live on Google" only when Google's own state
 * for the post says LIVE; a published post Google has not reported on yet
 * stays "Published", which is what the app knows.
 */
export function postStatus(post: Pick<PostRow, "status" | "googleState">): {
  label: string
  tone: PostTone
} {
  switch (post.status) {
    case "draft":
      return { label: "Draft", tone: "neutral" }
    case "awaiting_approval":
      return { label: "Awaiting approval", tone: "warn" }
    case "publishing":
      return { label: "Sent to Google — waiting", tone: "info" }
    case "failed":
      return { label: "Failed", tone: "bad" }
    case "ambiguous":
      return { label: "Needs checking", tone: "warn" }
    case "published":
      if (post.googleState === "LIVE")
        return { label: "Live on Google", tone: "ok" }
      if (post.googleState === "REJECTED")
        return { label: "Rejected by Google", tone: "bad" }
      if (post.googleState === "PROCESSING")
        return { label: "Google is processing it", tone: "info" }
      return { label: "Published", tone: "ok" }
  }
}

export type PostFilter =
  "all" | "draft" | "awaiting" | "published" | "attention"

export const POST_FILTERS: ReadonlyArray<{ value: PostFilter; label: string }> =
  [
    { value: "all", label: "All" },
    { value: "draft", label: "Drafts" },
    { value: "awaiting", label: "Awaiting approval" },
    { value: "published", label: "On Google" },
    { value: "attention", label: "Needs attention" },
  ]

export function postNeedsAttention(
  post: Pick<PostRow, "status" | "googleState">
): boolean {
  return (
    post.status === "failed" ||
    post.status === "ambiguous" ||
    (post.status === "published" && post.googleState === "REJECTED")
  )
}

export function matchesPostFilter(
  post: Pick<PostRow, "status" | "googleState">,
  filter: PostFilter
): boolean {
  switch (filter) {
    case "all":
      return true
    case "draft":
      return post.status === "draft"
    case "awaiting":
      return post.status === "awaiting_approval"
    case "published":
      return post.status === "published" || post.status === "publishing"
    case "attention":
      return postNeedsAttention(post)
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** The event or offer title Google shows above the text, if the post has one. */
export function postEventTitle(post: Pick<PostRow, "event">): string {
  const title = record(post.event)?.title
  return typeof title === "string" ? title : ""
}

type GoogleDate = { year?: number; month?: number; day?: number }
type GoogleTime = { hours?: number; minutes?: number }

function toDate(date: unknown, time: unknown): Date | null {
  const d = record(date) as GoogleDate | null
  if (!d || !d.year || !d.month || !d.day) return null
  const t = (record(time) ?? {}) as GoogleTime
  return new Date(d.year, d.month - 1, d.day, t.hours ?? 0, t.minutes ?? 0)
}

function hasTime(time: unknown): boolean {
  const t = record(time) as GoogleTime | null
  return Boolean(t && (t.hours !== undefined || t.minutes !== undefined))
}

/** "1 Oct, 20:00 – 1 Oct, 22:30" from Google's event schedule, or "". */
export function postSchedule(post: Pick<PostRow, "event">): string {
  const schedule = record(record(post.event)?.schedule)
  if (!schedule) return ""
  const start = toDate(schedule.startDate, schedule.startTime)
  const end = toDate(schedule.endDate, schedule.endTime)
  const format = (value: Date, withTime: boolean) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
    }).format(value)
  const parts = [
    start ? format(start, hasTime(schedule.startTime)) : "",
    end ? format(end, hasTime(schedule.endTime)) : "",
  ].filter(Boolean)
  return parts.join(" – ")
}

/** The button label Google shows under the post, if it has one. */
export function postActionLabel(post: Pick<PostRow, "callToAction">): string {
  const type = record(post.callToAction)?.actionType
  return typeof type === "string" && type in POST_ACTION_LABEL
    ? POST_ACTION_LABEL[type as LocalPostActionType]
    : ""
}

/** The first image the post carries (Google's `media[].sourceUrl`/`googleUrl`). */
export function postImageUrl(post: Pick<PostRow, "media">): string | null {
  if (!Array.isArray(post.media)) return null
  for (const entry of post.media) {
    const media = record(entry)
    const url = media?.googleUrl ?? media?.sourceUrl
    if (typeof url === "string" && /^https?:\/\//.test(url)) return url
  }
  return null
}

/** "20 Sep 2026, 16:40" for the row's last change. */
export function formatPostTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}
