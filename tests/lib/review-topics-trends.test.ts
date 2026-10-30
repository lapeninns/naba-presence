import { describe, expect, it } from "vitest"

import { REVIEW_TOPIC_LABELS, REVIEW_TOPICS } from "@/lib/domain/review-topics"
import {
  type ClassifiedCountRow,
  computeTopicTrends,
  isNegativeSpike,
  smoothedBaselineShare,
  SPIKE_RULE,
  type SpikeCounts,
  type TopicCountRow,
  type TopicLine,
  TREND_WEEKS,
  trendWeeks,
  topicTrendsCsv,
  weekStart,
} from "@/lib/domain/review-topics-trends"

// Friday afternoon; its week started Monday 26 October 2026.
const NOW = new Date("2026-10-30T15:00:00.000Z")
const WEEKS = [
  "2026-09-07",
  "2026-09-14",
  "2026-09-21",
  "2026-09-28",
  "2026-10-05",
  "2026-10-12",
  "2026-10-19",
  "2026-10-26",
]

const LOCATIONS = [
  { id: "loc-b", name: "The White Horse" },
  { id: "loc-a", name: "The Bell" },
  { id: "loc-c", name: "The Railway" },
]

const TOPIC_ROWS: TopicCountRow[] = [
  {
    locationId: "loc-a",
    week: "2026-10-26",
    topic: "food_quality",
    sentiment: "positive",
    count: 3,
  },
  {
    locationId: "loc-a",
    week: "2026-10-26",
    topic: "food_quality",
    sentiment: "negative",
    count: 1,
  },
  {
    locationId: "loc-a",
    week: "2026-10-19",
    topic: "food_quality",
    sentiment: "neutral",
    count: 2,
  },
  {
    locationId: "loc-a",
    week: "2026-10-19",
    topic: "service",
    sentiment: "negative",
    count: 2,
  },
  {
    locationId: "loc-b",
    week: "2026-10-26",
    topic: "food_quality",
    sentiment: "negative",
    count: 2,
  },
  {
    locationId: "loc-b",
    week: "2026-09-07",
    topic: "parking",
    sentiment: "positive",
    count: 1,
  },
  // Ignored: a week before the window, a day that is not a trend Monday,
  // and a location that was not asked for.
  {
    locationId: "loc-a",
    week: "2026-08-31",
    topic: "food_quality",
    sentiment: "positive",
    count: 50,
  },
  {
    locationId: "loc-a",
    week: "2026-10-27",
    topic: "food_quality",
    sentiment: "positive",
    count: 50,
  },
  {
    locationId: "loc-z",
    week: "2026-10-26",
    topic: "food_quality",
    sentiment: "positive",
    count: 50,
  },
]

const CLASSIFIED_ROWS: ClassifiedCountRow[] = [
  { locationId: "loc-a", week: "2026-10-26", reviews: 6 },
  { locationId: "loc-a", week: "2026-10-19", reviews: 4 },
  { locationId: "loc-b", week: "2026-10-26", reviews: 5 },
  { locationId: "loc-b", week: "2026-09-07", reviews: 3 },
  { locationId: "loc-a", week: "2026-08-31", reviews: 100 },
  { locationId: "loc-z", week: "2026-10-26", reviews: 100 },
]

function trends() {
  return computeTopicTrends({
    now: NOW,
    locations: LOCATIONS,
    topicRows: TOPIC_ROWS,
    classifiedRows: CLASSIFIED_ROWS,
  })
}

function line(topics: TopicLine[], topic: string): TopicLine {
  const found = topics.find((entry) => entry.topic === topic)
  if (!found) throw new Error(`missing topic ${topic}`)
  return found
}

const zeros = (n = 8) => Array.from({ length: n }, () => 0)

describe("weekStart", () => {
  it("returns Monday midnight UTC of the week", () => {
    expect(weekStart(new Date("2026-10-30T23:59:59.999Z")).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z"
    )
    expect(weekStart(new Date("2026-10-26T00:00:00.000Z")).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z"
    )
  })

  it("puts Sunday in the week that began the Monday before", () => {
    expect(weekStart(new Date("2026-11-01T12:00:00.000Z")).toISOString()).toBe(
      "2026-10-26T00:00:00.000Z"
    )
    // 00:30 on Monday in UTC+1 is still Sunday in UTC.
    expect(
      weekStart(new Date("2026-11-02T00:30:00.000+01:00")).toISOString()
    ).toBe("2026-10-26T00:00:00.000Z")
  })

  it("crosses month and year boundaries", () => {
    expect(weekStart(new Date("2026-01-01T09:00:00.000Z")).toISOString()).toBe(
      "2025-12-29T00:00:00.000Z"
    )
  })
})

describe("trendWeeks", () => {
  it("lists eight Mondays by default, oldest first, ending this week", () => {
    expect(TREND_WEEKS).toBe(8)
    expect(trendWeeks(NOW)).toEqual(WEEKS)
  })

  it("takes a custom number of weeks", () => {
    expect(trendWeeks(NOW, 3)).toEqual([
      "2026-10-12",
      "2026-10-19",
      "2026-10-26",
    ])
    expect(trendWeeks(new Date("2026-11-01T22:00:00.000Z"), 1)).toEqual([
      "2026-10-26",
    ])
  })
})

describe("computeTopicTrends", () => {
  it("returns the trend weeks", () => {
    expect(trends().weeks).toEqual(WEEKS)
  })

  it("has every listed location, sorted by name, even without data", () => {
    const result = trends()
    expect(
      result.locations.map((entry) => [entry.locationId, entry.name])
    ).toEqual([
      ["loc-a", "The Bell"],
      ["loc-c", "The Railway"],
      ["loc-b", "The White Horse"],
    ])
  })

  it("always lists all thirteen topics in vocabulary order", () => {
    const result = trends()
    for (const scope of [result.group, ...result.locations]) {
      expect(scope.topics.map((entry) => entry.topic)).toEqual([
        ...REVIEW_TOPICS,
      ])
    }
  })

  it("counts one location's mentions, shares and weekly series", () => {
    const bell = trends().locations[0]
    expect(bell.classifiedReviews).toBe(10)
    expect(line(bell.topics, "food_quality")).toEqual({
      topic: "food_quality",
      mentions: 6,
      positive: 3,
      neutral: 2,
      negative: 1,
      share: 0.6,
      negativeShare: 1 / 6,
      weekly: [0, 0, 0, 0, 0, 0, 2, 4],
      weeklyNegative: [0, 0, 0, 0, 0, 0, 0, 1],
    })
    expect(line(bell.topics, "service")).toEqual({
      topic: "service",
      mentions: 2,
      positive: 0,
      neutral: 0,
      negative: 2,
      share: 0.2,
      negativeShare: 1,
      weekly: [0, 0, 0, 0, 0, 0, 2, 0],
      weeklyNegative: [0, 0, 0, 0, 0, 0, 2, 0],
    })
    // A topic nobody mentioned: share is a real 0, negative share is unknown.
    expect(line(bell.topics, "parking")).toEqual({
      topic: "parking",
      mentions: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
      share: 0,
      negativeShare: null,
      weekly: zeros(),
      weeklyNegative: zeros(),
    })
  })

  it("leaves shares unknown for a location with no classified reviews", () => {
    const railway = trends().locations[1]
    expect(railway.classifiedReviews).toBe(0)
    for (const entry of railway.topics) {
      expect(entry.mentions).toBe(0)
      expect(entry.share).toBeNull()
      expect(entry.negativeShare).toBeNull()
      expect(entry.weekly).toEqual(zeros())
      expect(entry.weeklyNegative).toEqual(zeros())
    }
  })

  it("sums the group across listed locations only", () => {
    const { group } = trends()
    expect(group.classifiedReviews).toBe(18)
    expect(line(group.topics, "food_quality")).toEqual({
      topic: "food_quality",
      mentions: 8,
      positive: 3,
      neutral: 2,
      negative: 3,
      share: 8 / 18,
      negativeShare: 3 / 8,
      weekly: [0, 0, 0, 0, 0, 0, 2, 6],
      weeklyNegative: [0, 0, 0, 0, 0, 0, 0, 3],
    })
    expect(line(group.topics, "parking")).toMatchObject({
      mentions: 1,
      positive: 1,
      share: 1 / 18,
      negativeShare: 0,
      weekly: [1, 0, 0, 0, 0, 0, 0, 0],
      weeklyNegative: zeros(),
    })
    expect(line(group.topics, "service")).toMatchObject({
      mentions: 2,
      negative: 2,
      share: 2 / 18,
      negativeShare: 1,
    })
  })

  it("honours a shorter window and ignores rows outside it", () => {
    const result = computeTopicTrends({
      now: NOW,
      weeks: 1,
      locations: LOCATIONS,
      topicRows: TOPIC_ROWS,
      classifiedRows: CLASSIFIED_ROWS,
    })
    expect(result.weeks).toEqual(["2026-10-26"])
    expect(result.group.classifiedReviews).toBe(11)
    expect(line(result.group.topics, "food_quality")).toEqual({
      topic: "food_quality",
      mentions: 6,
      positive: 3,
      neutral: 0,
      negative: 3,
      share: 6 / 11,
      negativeShare: 0.5,
      weekly: [6],
      weeklyNegative: [3],
    })
    expect(line(result.group.topics, "parking").mentions).toBe(0)
  })

  it("handles no locations at all", () => {
    const result = computeTopicTrends({
      now: NOW,
      locations: [],
      topicRows: TOPIC_ROWS,
      classifiedRows: CLASSIFIED_ROWS,
    })
    expect(result.locations).toEqual([])
    expect(result.group.classifiedReviews).toBe(0)
    expect(result.group.topics).toHaveLength(REVIEW_TOPICS.length)
    for (const entry of result.group.topics) {
      expect(entry.mentions).toBe(0)
      expect(entry.share).toBeNull()
    }
  })
})

describe("negative spike rule", () => {
  const counts = (
    recentNegative: number,
    recentMentions: number,
    baselineNegative = 0,
    baselineMentions = 0
  ): SpikeCounts => ({
    recentMentions,
    recentNegative,
    baselineMentions,
    baselineNegative,
  })

  it("has the agreed thresholds", () => {
    expect(SPIKE_RULE).toEqual({
      recentDays: 14,
      baselineDays: 90,
      minNegative: 3,
      minRecentShare: 0.5,
      minLift: 0.25,
      priorNegativeShare: 0.25,
      priorWeight: 4,
    })
  })

  it("smooths the baseline towards the prior", () => {
    expect(smoothedBaselineShare(counts(0, 0))).toBeCloseTo(0.25, 10)
    expect(smoothedBaselineShare(counts(0, 0, 60, 100))).toBeCloseTo(
      61 / 104,
      10
    )
    expect(smoothedBaselineShare(counts(0, 0, 0, 4))).toBeCloseTo(1 / 8, 10)
  })

  it("never fires on two negatives", () => {
    expect(isNegativeSpike(counts(2, 2))).toBe(false)
    expect(isNegativeSpike(counts(2, 2, 0, 100))).toBe(false)
  })

  it("fires on three of three with no baseline", () => {
    expect(isNegativeSpike(counts(3, 3))).toBe(true)
  })

  it("fires exactly at the share and lift boundary", () => {
    // 3/6 = 0.5 share; smoothed baseline 0.25; lift 0.25.
    expect(isNegativeSpike(counts(3, 6))).toBe(true)
  })

  it("does not fire below half negative", () => {
    expect(isNegativeSpike(counts(3, 7))).toBe(false)
  })

  it("does not fire when the baseline was already bad", () => {
    // 5/6 against a smoothed 61/104: lift just under 0.25.
    expect(isNegativeSpike(counts(5, 6, 60, 100))).toBe(false)
  })

  it("does not fire with no recent mentions", () => {
    expect(isNegativeSpike(counts(0, 0))).toBe(false)
    expect(isNegativeSpike(counts(0, 0, 50, 100))).toBe(false)
  })
})

describe("topicTrendsCsv", () => {
  it("starts with a header naming each trend week", () => {
    const rows = topicTrendsCsv(trends())
    expect(rows[0]).toEqual([
      "Listing",
      "Topic",
      "Reviews classified",
      "Mentions",
      "Share of reviews",
      "Negative mentions",
      "Negative share",
      ...WEEKS.map((week) => `Week of ${week}`),
    ])
  })

  it("writes 13 group rows, then 13 rows per location in order", () => {
    const rows = topicTrendsCsv(trends())
    expect(rows).toHaveLength(1 + REVIEW_TOPICS.length * 4)
    const venues = rows.slice(1).map((row) => row[0])
    const blocks = [
      "All listings",
      "The Bell",
      "The Railway",
      "The White Horse",
    ]
    expect(venues).toEqual(
      blocks.flatMap((venue) => REVIEW_TOPICS.map(() => venue))
    )
    for (let block = 0; block < blocks.length; block++) {
      const topics = rows
        .slice(
          1 + block * REVIEW_TOPICS.length,
          1 + (block + 1) * REVIEW_TOPICS.length
        )
        .map((row) => row[1])
      expect(topics).toEqual(
        REVIEW_TOPICS.map((topic) => REVIEW_TOPIC_LABELS[topic])
      )
    }
  })

  it("rounds shares to three places and leaves missing ones empty", () => {
    const rows = topicTrendsCsv(trends())
    const find = (venue: string, topic: (typeof REVIEW_TOPICS)[number]) => {
      const row = rows.find(
        (entry) => entry[0] === venue && entry[1] === REVIEW_TOPIC_LABELS[topic]
      )
      if (!row) throw new Error(`missing row ${venue} ${topic}`)
      return row
    }
    expect(find("All listings", "food_quality")).toEqual([
      "All listings",
      REVIEW_TOPIC_LABELS.food_quality,
      18,
      8,
      0.444,
      3,
      0.375,
      0,
      0,
      0,
      0,
      0,
      0,
      2,
      6,
    ])
    expect(find("The Bell", "food_quality")).toEqual([
      "The Bell",
      REVIEW_TOPIC_LABELS.food_quality,
      10,
      6,
      0.6,
      1,
      0.167,
      0,
      0,
      0,
      0,
      0,
      0,
      2,
      4,
    ])
    // Nobody mentioned it: a real 0 share, an unknown negative share.
    expect(find("All listings", "cleanliness").slice(2, 7)).toEqual([
      18,
      0,
      0,
      0,
      null,
    ])
    // No classified reviews: both shares unknown, never 0.
    expect(find("The Railway", "food_quality")).toEqual([
      "The Railway",
      REVIEW_TOPIC_LABELS.food_quality,
      0,
      0,
      null,
      0,
      null,
      ...zeros(),
    ])
  })
})
