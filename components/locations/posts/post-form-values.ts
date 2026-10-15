import type { Post } from "@/lib/api/location-posts"
import {
  LOCAL_POST_ACTION_TYPES,
  type LocalPostActionType,
  type LocalPostTopicType,
} from "@/lib/contracts/location-posts"
import {
  DEFAULT_TIMEZONE,
  recurrenceFields,
  type RecurrenceFields,
} from "@/lib/locations/post-recurrence"

// The post composer's field values, apart from the composer itself: a post's
// actions preview a saved post with them without loading the composer sheet,
// which opens rarely and loads on demand.

export type PostFormValues = {
  topicType: LocalPostTopicType
  summary: string
  eventTitle: string
  startDate: string
  startTime: string
  endDate: string
  endTime: string
  couponCode: string
  redeemUrl: string
  terms: string
  action: LocalPostActionType | ""
  actionUrl: string
  /**
   * A photo chosen in the composer (a public image link, Google's copy of a
   * library photo). Empty keeps whatever photos the saved post already has.
   */
  photoUrl: string
} & RecurrenceFields

export function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

const pad = (value: unknown) =>
  typeof value === "number" ? String(value).padStart(2, "0") : ""

/** Google's `{ year, month, day }` → `2026-10-01`, or "" when incomplete. */
function formDate(value: unknown): string {
  const date = record(value)
  if (!date || !date.year || !date.month || !date.day) return ""
  return `${date.year}-${pad(date.month)}-${pad(date.day)}`
}

/** Google's `{ hours, minutes }` → `20:30`, or "" when absent. */
function formTime(value: unknown): string {
  const time = record(value)
  if (!time) return ""
  return `${pad(time.hours ?? 0)}:${pad(time.minutes ?? 0)}`
}

/** A saved post back into the composer's fields, for editing and previews. */
export function postFormValues(
  post: Post,
  timeZone: string = DEFAULT_TIMEZONE
): PostFormValues {
  const event = record(post.event)
  const schedule = record(event?.schedule)
  const offer = record(post.offer)
  const cta = record(post.callToAction)
  const action = LOCAL_POST_ACTION_TYPES.find(
    (type) => type === cta?.actionType
  )
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  return {
    topicType: post.topicType,
    summary: post.summary,
    eventTitle: text(event?.title),
    startDate: formDate(schedule?.startDate),
    startTime: formTime(schedule?.startTime),
    endDate: formDate(schedule?.endDate),
    endTime: formTime(schedule?.endTime),
    couponCode: text(offer?.couponCode),
    redeemUrl: text(offer?.redeemOnlineUrl),
    terms: text(offer?.termsConditions),
    action: action ?? "",
    actionUrl: text(cta?.url),
    photoUrl: "",
    ...recurrenceFields(event, timeZone),
  }
}
