import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"

const LABELS: Record<GooglePerformanceMetric, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Maps views (desktop)",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Search views (desktop)",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Maps views (mobile)",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Search views (mobile)",
  // Google counts taps on the Call button, not calls placed or answered.
  CALL_CLICKS: "Call button taps",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Directions requests",
  BUSINESS_CONVERSATIONS: "Messages",
  // Google counts booking actions started from the profile, not completed reservations.
  BUSINESS_BOOKINGS: "Booking button clicks",
  BUSINESS_FOOD_ORDERS: "Food orders",
  BUSINESS_FOOD_MENU_CLICKS: "Menu views",
}

export const ORDERED_METRICS = GOOGLE_PERFORMANCE_METRICS

export const IMPRESSION_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
] as const satisfies readonly GooglePerformanceMetric[]

export function metricLabel(metric: GooglePerformanceMetric): string {
  return LABELS[metric]
}

/**
 * The five headline figures (reference Google performance tiles). Views are
 * shown as Search and Maps, each the sum of Google's desktop and mobile
 * counts; nothing is estimated.
 */
export const HEADLINE_METRICS: ReadonlyArray<{
  key: string
  label: string
  hint?: string
  metrics: readonly GooglePerformanceMetric[]
}> = [
  {
    key: "search",
    label: "Search views",
    hint: "Desktop and mobile",
    metrics: [
      "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
      "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
    ],
  },
  {
    key: "maps",
    label: "Maps views",
    hint: "Desktop and mobile",
    metrics: [
      "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
      "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
    ],
  },
  { key: "calls", label: "Call button taps", hint: "Not calls answered", metrics: ["CALL_CLICKS"] },
  { key: "web", label: "Website clicks", metrics: ["WEBSITE_CLICKS"] },
  {
    key: "directions",
    label: metricLabel("BUSINESS_DIRECTION_REQUESTS"),
    metrics: ["BUSINESS_DIRECTION_REQUESTS"],
  },
]

/** The remaining profile actions, listed under the headline tiles. */
export const OTHER_ACTION_METRICS = [
  "BUSINESS_CONVERSATIONS",
  "BUSINESS_BOOKINGS",
  "BUSINESS_FOOD_ORDERS",
  "BUSINESS_FOOD_MENU_CLICKS",
] as const satisfies readonly GooglePerformanceMetric[]

/** Chart series: views stacked by surface, actions stacked by kind. */
export const VIEW_SERIES_KEYS = {
  search: HEADLINE_METRICS[0].metrics,
  maps: HEADLINE_METRICS[1].metrics,
} as const

export const ACTION_SERIES_KEYS = {
  calls: ["CALL_CLICKS"],
  web: ["WEBSITE_CLICKS"],
  directions: ["BUSINESS_DIRECTION_REQUESTS"],
} as const

/** Null only when every metric is missing; a missing part of a sum is never read as zero. */
export function sumMetrics(
  totals: Record<GooglePerformanceMetric, number | null>,
  metrics: readonly GooglePerformanceMetric[]
): number | null {
  const present = metrics
    .map((metric) => totals[metric])
    .filter((value): value is number => typeof value === "number")
  return present.length ? present.reduce((sum, value) => sum + value, 0) : null
}
