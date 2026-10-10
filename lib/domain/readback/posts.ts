// Client-safe readback adapter for local posts (lib/server/posts.ts). Compares
// the content a post was published with against what Google holds: topic,
// language, summary, call to action, event title and schedule, and the offer
// fields. Output-only fields Google adds (name, state, searchUrl, createTime,
// the event's recurringInstanceTime, media Google rehosts) are not compared.
import {
  isEmptyValue,
  isRecord,
  normalizeDate,
  normalizeText,
  normalizeTimeOfDay,
  normalizeUri,
} from "./compare"

export type LocalPostField =
  "topicType" | "languageCode" | "summary" | "callToAction" | "event" | "offer"

function record(value: unknown) {
  return isRecord(value) ? value : {}
}

function upper(value: unknown) {
  return typeof value === "string" ? value.trim().toUpperCase() : ""
}

function callToActionMatches(actual: unknown, expected: unknown) {
  if (isEmptyValue(expected)) return isEmptyValue(actual)
  const live = record(actual)
  const want = record(expected)
  return (
    upper(live.actionType) === upper(want.actionType) &&
    normalizeUri(live.url) === normalizeUri(want.url)
  )
}

function scheduleMatches(actual: unknown, expected: unknown) {
  const live = record(actual)
  const want = record(expected)
  const date = (key: string, source: Record<string, unknown>) =>
    normalizeDate(source[key])
  const time = (key: string, source: Record<string, unknown>) =>
    // A missing time on either side is "all day"; Google may echo 00:00.
    normalizeTimeOfDay(source[key]) ?? normalizeTimeOfDay({})
  return (
    date("startDate", live) === date("startDate", want) &&
    date("endDate", live) === date("endDate", want) &&
    time("startTime", live) === time("startTime", want) &&
    time("endTime", live) === time("endTime", want)
  )
}

function eventMatches(actual: unknown, expected: unknown) {
  if (isEmptyValue(expected)) return isEmptyValue(actual)
  const live = record(actual)
  const want = record(expected)
  return (
    normalizeText(live.title) === normalizeText(want.title) &&
    scheduleMatches(live.schedule, want.schedule)
  )
}

function offerMatches(actual: unknown, expected: unknown) {
  if (isEmptyValue(expected)) return isEmptyValue(actual)
  const live = record(actual)
  const want = record(expected)
  return (
    normalizeText(live.couponCode) === normalizeText(want.couponCode) &&
    normalizeUri(live.redeemOnlineUrl) === normalizeUri(want.redeemOnlineUrl) &&
    normalizeText(live.termsConditions) === normalizeText(want.termsConditions)
  )
}

/**
 * The content fields of `live` that differ from `intended`. A field the
 * intent leaves out must be absent (or empty) on Google too, so a cleared
 * event or offer that Google kept is a difference.
 */
export function localPostMismatches(
  live: unknown,
  intended: unknown
): LocalPostField[] {
  const actual = record(live)
  const want = record(intended)
  const mismatches: LocalPostField[] = []
  if (upper(actual.topicType) !== upper(want.topicType))
    mismatches.push("topicType")
  if (
    String(actual.languageCode ?? "")
      .trim()
      .toLowerCase() !==
    String(want.languageCode ?? "")
      .trim()
      .toLowerCase()
  )
    mismatches.push("languageCode")
  if (normalizeText(actual.summary) !== normalizeText(want.summary))
    mismatches.push("summary")
  if (!callToActionMatches(actual.callToAction, want.callToAction))
    mismatches.push("callToAction")
  if (!eventMatches(actual.event, want.event)) mismatches.push("event")
  if (!offerMatches(actual.offer, want.offer)) mismatches.push("offer")
  return mismatches
}

/** True when Google holds the post content that was sent. */
export function localPostMatches(live: unknown, intended: unknown): boolean {
  return localPostMismatches(live, intended).length === 0
}
