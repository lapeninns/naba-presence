export type ReplyRangeId = "30d" | "90d" | "12m" | "18m"

export const REPLY_RANGES: Array<{
  id: ReplyRangeId
  label: string
  granularity: "day" | "week" | "month"
  days: number
}> = [
  { id: "30d", label: "Last 30 days", granularity: "day", days: 30 },
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
  const preset = REPLY_RANGES.find((range) => range.id === id) ?? REPLY_RANGES[0]
  const to = now.toISOString()
  const from = isoAt(now, preset.days)
  const previousTo = from
  const previousFrom = isoAt(now, preset.days * 2)
  return {
    current: { from, to, granularity: preset.granularity },
    previous: { from: previousFrom, to: previousTo, granularity: preset.granularity },
  }
}

export const PRESENCE_RANGES: Array<{ id: "28d" | "90d" | "12m" | "18m"; label: string }> = [
  { id: "28d", label: "Last 28 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]

export const KEYWORD_RANGES: Array<{ id: "1m" | "6m" | "12m" | "18m"; label: string }> = [
  { id: "1m", label: "Last month" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "18m", label: "Last 18 months" },
]
