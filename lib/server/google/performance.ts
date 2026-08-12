import "server-only"

import {
  googlePerformanceRequest,
  googleSearchKeywordImpressionsRequest,
  type GooglePerformanceMetric,
} from "@/lib/domain/google-contract"
import { ApiError } from "@/lib/server/http"

import { googleRequest } from "./transport"

export type GooglePerformancePoint = {
  metric: GooglePerformanceMetric
  date: string
  value: number
}

export type GoogleSearchKeywordPoint = {
  keyword: string
  impressions: number | null
  threshold: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isExpectedMetric(
  value: string,
  expectedMetrics: ReadonlySet<string>
): value is GooglePerformanceMetric {
  return expectedMetrics.has(value)
}

export async function googlePerformanceMetrics(
  accessToken: string,
  input: {
    readonly locationName: string
    readonly metrics: readonly GooglePerformanceMetric[]
    readonly startDate: string
    readonly endDate: string
  },
  options: { readonly connectionKey?: string } = {}
): Promise<GooglePerformancePoint[]> {
  const request = googlePerformanceRequest(input)
  const response = await googleRequest<Record<string, unknown>>(
    request.url,
    accessToken,
    request.init,
    options
  )
  return normalizeGooglePerformanceResponse(response, input.metrics)
}

export function normalizeGooglePerformanceResponse(
  response: Record<string, unknown>,
  expectedMetrics: readonly GooglePerformanceMetric[]
): GooglePerformancePoint[] {
  const knownMetrics = new Set<string>(expectedMetrics)
  const series = Array.isArray(response["multiDailyMetricTimeSeries"])
    ? response["multiDailyMetricTimeSeries"]
    : []
  const points: GooglePerformancePoint[] = []
  for (const entry of series) {
    if (!isRecord(entry)) continue
    const wrappedSeries = entry["dailyMetricTimeSeries"]
    const metricSeries = isRecord(wrappedSeries) ? wrappedSeries : entry
    const metric = metricSeries["dailyMetric"]
    if (typeof metric !== "string" || !isExpectedMetric(metric, knownMetrics)) {
      continue
    }
    const timeSeries = metricSeries["timeSeries"]
    const datedValues =
      isRecord(timeSeries) && Array.isArray(timeSeries["datedValues"])
        ? timeSeries["datedValues"]
        : []
    for (const datedValue of datedValues) {
      if (!isRecord(datedValue)) continue
      const date = datedValue["date"]
      const dateRecord = isRecord(date) ? date : null
      const year = Number(dateRecord?.["year"])
      const month = Number(dateRecord?.["month"])
      const day = Number(dateRecord?.["day"])
      const value = Number(datedValue["value"])
      if (
        !Number.isInteger(year) ||
        !Number.isInteger(month) ||
        !Number.isInteger(day) ||
        !Number.isSafeInteger(value) ||
        value < 0
      ) {
        continue
      }
      points.push({
        metric,
        date: `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        value,
      })
    }
  }
  return points
}

export function normalizeGoogleSearchKeywordResponse(
  response: Record<string, unknown>
): GoogleSearchKeywordPoint[] {
  const counts = Array.isArray(response["searchKeywordsCounts"])
    ? response["searchKeywordsCounts"]
    : []
  const points: GoogleSearchKeywordPoint[] = []
  for (const entry of counts) {
    if (!isRecord(entry)) continue
    const searchKeyword = entry["searchKeyword"]
    const keyword =
      typeof searchKeyword === "string"
        ? searchKeyword.trim().toLocaleLowerCase("en-GB")
        : ""
    const insightsValue = entry["insightsValue"]
    const insight = isRecord(insightsValue) ? insightsValue : null
    const insightValue = insight?.["value"]
    const insightThreshold = insight?.["threshold"]
    const value = insightValue === undefined ? null : Number(insightValue)
    const threshold =
      insightThreshold === undefined ? null : Number(insightThreshold)
    const validValue =
      value !== null && Number.isSafeInteger(value) && value >= 0
    const validThreshold =
      threshold !== null && Number.isSafeInteger(threshold) && threshold >= 0
    if (!keyword || validValue === validThreshold) continue
    points.push({
      keyword,
      impressions: validValue ? value : null,
      threshold: validThreshold ? threshold : null,
    })
  }
  return points
}

export async function googleSearchKeywordImpressions(
  accessToken: string,
  input: { readonly locationName: string; readonly month: string },
  options: { readonly connectionKey?: string; readonly maxPages?: number } = {}
): Promise<GoogleSearchKeywordPoint[]> {
  const points: GoogleSearchKeywordPoint[] = []
  let pageToken: string | undefined
  const maxPages = Math.min(100, Math.max(1, options.maxPages ?? 100))
  for (let page = 0; page < maxPages; page += 1) {
    const request = googleSearchKeywordImpressionsRequest({
      ...input,
      pageToken,
    })
    const response = await googleRequest<Record<string, unknown>>(
      request.url,
      accessToken,
      request.init,
      { connectionKey: options.connectionKey }
    )
    points.push(...normalizeGoogleSearchKeywordResponse(response))
    const nextPageToken = response["nextPageToken"]
    pageToken =
      typeof nextPageToken === "string" && nextPageToken
        ? nextPageToken
        : undefined
    if (!pageToken) return points
  }
  throw new ApiError(
    502,
    "google_keyword_page_limit",
    "Google search-keyword pagination exceeded the safety limit."
  )
}
