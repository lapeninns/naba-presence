import {
  GOOGLE_PERFORMANCE_METRICS,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"

const LABELS: Record<GooglePerformanceMetric, string> = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "Maps views (desktop)",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "Search views (desktop)",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "Maps views (mobile)",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "Search views (mobile)",
  CALL_CLICKS: "Calls",
  WEBSITE_CLICKS: "Website clicks",
  BUSINESS_DIRECTION_REQUESTS: "Directions requests",
  BUSINESS_CONVERSATIONS: "Messages",
  BUSINESS_BOOKINGS: "Bookings",
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
