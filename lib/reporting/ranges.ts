import { formatDate } from "@/lib/format"

/**
 * The reports' periods.
 *
 * Reply performance and Google performance offer the same four periods, so
 * switching tab keeps the period on screen. Reply figures are computed from
 * our own reviews over any window; the Google figures endpoint takes exactly
 * these four, so they are the shared set. Keywords are monthly at Google, so
 * that tab counts in whole months, sharing 12 and 18 months with the others.
 */
export type ReplyRangeId = "28d" | "90d" | "12m" | "18m"

export const REPLY_RANGES: Array<{
  id: ReplyRangeId
  label: string
  granularity: "day" | "week" | "month"
  days: number
}> = [
  { id: "28d", label: "Last 28 days", granularity: "day", days: 28 },
  { id: "90d", label: "Last 90 days", granularity: "week", days: 90 },
  { id: "12m", label: "Last 12 months", granularity: "month", days: 365 },
  { id: "18m", label: "Last 18 months", granularity: "month", days: 548 },
]

function isoAt(now: Date, daysAgo: number): string {
  return new Date(now.getTime() - daysAgo * 86_400_000).toISOString()
}

// Current window [from, to) and the immediately-preceding equal-length window,
// so a prior-window delta compares like with like. `previous.to === current.from`.
export function resolveReplyRange(id: ReplyRangeId, now: Date = new Date()) {
  const preset =
    REPLY_RANGES.find((range) => range.id === id) ?? REPLY_RANGES[0]
  const to = now.toISOString()
  const from = isoAt(now, preset.days)
  const previousTo = from
  const previousFrom = isoAt(now, preset.days * 2)
  return {
    current: { from, to, granularity: preset.granularity },
    previous: {
      from: previousFrom,
      to: previousTo,
      granularity: preset.granularity,
    },
  }
}

export const PRESENCE_RANGES: Array<{
  id: "28d" | "90d" | "12m" | "18m"
  label: string
}> = [
  { id: "28d", label: "Last 28 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]

/** Days in each Google figures period, as the presence endpoint counts them. */
const PRESENCE_DAYS: Record<(typeof PRESENCE_RANGES)[number]["id"], number> = {
  "28d": 28,
  "90d": 90,
  "12m": 365,
  "18m": 548,
}

export const KEYWORD_RANGES: Array<{
  id: "1m" | "6m" | "12m" | "18m"
  label: string
}> = [
  { id: "1m", label: "Last month" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]

const KEYWORD_MONTHS: Record<(typeof KEYWORD_RANGES)[number]["id"], number> = {
  "1m": 1,
  "6m": 6,
  "12m": 12,
  "18m": 18,
}

export type ReportTab = "reply" | "google" | "keywords"
export type PresenceRangeId = (typeof PRESENCE_RANGES)[number]["id"]
export type KeywordRangeId = (typeof KEYWORD_RANGES)[number]["id"]
export type RangeFor<T extends ReportTab> = T extends "reply"
  ? ReplyRangeId
  : T extends "google"
    ? PresenceRangeId
    : KeywordRangeId

const OPTIONS: Record<ReportTab, ReadonlyArray<{ id: string }>> = {
  reply: REPLY_RANGES,
  google: PRESENCE_RANGES,
  keywords: KEYWORD_RANGES,
}

export const DEFAULT_RANGES: { [T in ReportTab]: RangeFor<T> } = {
  reply: "28d",
  google: "28d",
  keywords: "6m",
}

/**
 * The period a tab shows for `?range=`: the value when that tab offers it,
 * otherwise the tab's default. One parameter serves all three tabs, so a
 * period two tabs share survives switching between them.
 */
export function parseRange<T extends ReportTab>(
  tab: T,
  raw: string | null | undefined
): RangeFor<T> {
  const found = OPTIONS[tab].find((option) => option.id === raw)
  return (found ? found.id : DEFAULT_RANGES[tab]) as RangeFor<T>
}

/**
 * The dates a period covers, as the endpoints resolve it, so the page can
 * say "4 Aug – 31 Aug" instead of only "Last 28 days".
 *
 * Reply: the rolling window ending now. Google: whole UTC days ending today
 * (the presence route). Keywords: whole months from the first of the
 * earliest month (the keywords route).
 */
export function resolvedPeriod<T extends ReportTab>(
  tab: T,
  range: RangeFor<T>,
  now: Date = new Date()
): { from: string; to: string } {
  if (tab === "reply") {
    const { current } = resolveReplyRange(range as ReplyRangeId, now)
    return { from: current.from, to: current.to }
  }
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  )
  if (tab === "google") {
    const start = new Date(today)
    start.setUTCDate(
      start.getUTCDate() - PRESENCE_DAYS[range as PresenceRangeId] + 1
    )
    return { from: start.toISOString(), to: today.toISOString() }
  }
  const start = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth() - KEYWORD_MONTHS[range as KeywordRangeId] + 1,
      1
    )
  )
  return { from: start.toISOString(), to: today.toISOString() }
}

/** Whether both ends of a period are real dates. */
export function isValidPeriod(
  period: { from: string; to: string } | null | undefined
): period is { from: string; to: string } {
  return (
    !!period &&
    Number.isFinite(Date.parse(period.from)) &&
    Number.isFinite(Date.parse(period.to))
  )
}

/**
 * "4 Aug – 31 Aug", with the year when either end is not this year. Empty
 * when either end is not a date, rather than throwing mid-render.
 */
export function formatPeriod(
  period: { from: string; to: string },
  timeZone: string
): string {
  if (!isValidPeriod(period)) return ""
  return `${formatDate(period.from, timeZone)} – ${formatDate(period.to, timeZone)}`
}
