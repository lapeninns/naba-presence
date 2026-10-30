/**
 * Topic share and weekly trend over classified reviews, and the rule that
 * says a venue's topic has turned sharply negative. Plain arithmetic: no
 * review text, reviewer names or AI here. Pure and client-safe.
 *
 * Week bucketing (Monday 00:00 UTC, oldest week first, the current week
 * last) is adapted from context/opengmb/reviews/topic-trends.ts.
 * Adapted from OpenGMB (MIT, © 2026 Synectus Private Limited)
 */

import type { CsvCell } from "@/lib/domain/csv"
import {
  REVIEW_TOPICS,
  REVIEW_TOPIC_LABELS,
  type ReviewTopic,
  type TopicSentiment,
} from "@/lib/domain/review-topics"

export const TREND_WEEKS = 8

const DAY_MS = 86_400_000

/** Monday 00:00 UTC of the week containing `d`. */
export function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY_MS
  )
}

/** The trend's weeks as Monday dates, oldest first; the last is this week. */
export function trendWeeks(now: Date, weeks = TREND_WEEKS): string[] {
  const last = weekStart(now).getTime()
  return Array.from({ length: weeks }, (_, index) =>
    new Date(last - (weeks - 1 - index) * 7 * DAY_MS).toISOString().slice(0, 10)
  )
}

/** Topic mentions of one venue in one week, by sentiment. */
export type TopicCountRow = {
  locationId: string
  week: string
  topic: ReviewTopic
  sentiment: TopicSentiment
  count: number
}

/** Classified reviews of one venue in one week, topics or not. */
export type ClassifiedCountRow = {
  locationId: string
  week: string
  reviews: number
}

export type TopicLine = {
  topic: ReviewTopic
  mentions: number
  positive: number
  neutral: number
  negative: number
  /** Mentions over classified reviews; null with no classified review. */
  share: number | null
  /** Negative mentions over mentions; null with no mention. */
  negativeShare: number | null
  /** Mentions per trend week, oldest first. */
  weekly: number[]
  weeklyNegative: number[]
}

export type TopicScope = { classifiedReviews: number; topics: TopicLine[] }

export type TopicTrends = {
  weeks: string[]
  group: TopicScope
  locations: (TopicScope & { locationId: string; name: string })[]
}

type Tally = {
  classified: number
  topics: Map<
    ReviewTopic,
    Record<TopicSentiment, number> & {
      weekly: number[]
      weeklyNegative: number[]
    }
  >
}

function emptyTally(weeks: number): Tally {
  return {
    classified: 0,
    topics: new Map(
      REVIEW_TOPICS.map((topic) => [
        topic,
        {
          positive: 0,
          neutral: 0,
          negative: 0,
          weekly: Array<number>(weeks).fill(0),
          weeklyNegative: Array<number>(weeks).fill(0),
        },
      ])
    ),
  }
}

function toScope(tally: Tally): TopicScope {
  return {
    classifiedReviews: tally.classified,
    topics: REVIEW_TOPICS.map((topic) => {
      const counts = tally.topics.get(topic)!
      const mentions = counts.positive + counts.neutral + counts.negative
      return {
        topic,
        mentions,
        positive: counts.positive,
        neutral: counts.neutral,
        negative: counts.negative,
        share: tally.classified === 0 ? null : mentions / tally.classified,
        negativeShare: mentions === 0 ? null : counts.negative / mentions,
        weekly: counts.weekly,
        weeklyNegative: counts.weeklyNegative,
      }
    }),
  }
}

export function computeTopicTrends(input: {
  now: Date
  weeks?: number
  locations: { id: string; name: string }[]
  topicRows: TopicCountRow[]
  classifiedRows: ClassifiedCountRow[]
}): TopicTrends {
  const weeks = trendWeeks(input.now, input.weeks ?? TREND_WEEKS)
  const slot = new Map(weeks.map((week, index) => [week, index]))
  const group = emptyTally(weeks.length)
  const byLocation = new Map(
    input.locations.map((location) => [location.id, emptyTally(weeks.length)])
  )
  for (const row of input.classifiedRows) {
    const tally = byLocation.get(row.locationId)
    if (!tally || !slot.has(row.week)) continue
    tally.classified += row.reviews
    group.classified += row.reviews
  }
  for (const row of input.topicRows) {
    const tally = byLocation.get(row.locationId)
    const index = slot.get(row.week)
    if (!tally || index === undefined) continue
    for (const target of [tally, group]) {
      const counts = target.topics.get(row.topic)
      if (!counts) continue
      counts[row.sentiment] += row.count
      counts.weekly[index] += row.count
      if (row.sentiment === "negative")
        counts.weeklyNegative[index] += row.count
    }
  }
  return {
    weeks,
    group: toScope(group),
    locations: input.locations
      .map((location) => ({
        locationId: location.id,
        name: location.name,
        ...toScope(byLocation.get(location.id)!),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  }
}

/**
 * When a venue's topic has turned sharply negative: in the last 14 days at
 * least three negative mentions, at least half of its mentions negative, and
 * that share at least 25 points above the venue's own baseline for the topic
 * over the 90 days before. The baseline is smoothed towards a 25% prior
 * (weight 4 mentions), so a topic the venue was rarely reviewed on cannot
 * fire on a tiny base, and one bad week on a topic that is always mixed does
 * not either.
 */
export const SPIKE_RULE = {
  recentDays: 14,
  baselineDays: 90,
  minNegative: 3,
  minRecentShare: 0.5,
  minLift: 0.25,
  priorNegativeShare: 0.25,
  priorWeight: 4,
} as const

export type SpikeCounts = {
  recentMentions: number
  recentNegative: number
  baselineMentions: number
  baselineNegative: number
}

export function smoothedBaselineShare(counts: SpikeCounts): number {
  return (
    (counts.baselineNegative +
      SPIKE_RULE.priorNegativeShare * SPIKE_RULE.priorWeight) /
    (counts.baselineMentions + SPIKE_RULE.priorWeight)
  )
}

export function isNegativeSpike(counts: SpikeCounts): boolean {
  if (counts.recentMentions <= 0) return false
  if (counts.recentNegative < SPIKE_RULE.minNegative) return false
  const recentShare = counts.recentNegative / counts.recentMentions
  return (
    recentShare >= SPIKE_RULE.minRecentShare &&
    recentShare - smoothedBaselineShare(counts) >= SPIKE_RULE.minLift
  )
}

const ratio = (value: number | null) =>
  value === null ? null : Math.round(value * 1000) / 1000

/** The group and every venue, one row per topic, for the CSV export. */
export function topicTrendsCsv(trends: TopicTrends): CsvCell[][] {
  const rows = (name: string, scope: TopicScope): CsvCell[][] =>
    scope.topics.map((line) => [
      name,
      REVIEW_TOPIC_LABELS[line.topic],
      scope.classifiedReviews,
      line.mentions,
      ratio(line.share),
      line.negative,
      ratio(line.negativeShare),
      ...line.weekly,
    ])
  return [
    [
      "Listing",
      "Topic",
      "Reviews classified",
      "Mentions",
      "Share of reviews",
      "Negative mentions",
      "Negative share",
      ...trends.weeks.map((week) => `Week of ${week}`),
    ],
    ...rows("All listings", trends.group),
    ...trends.locations.flatMap((location) => rows(location.name, location)),
  ]
}
