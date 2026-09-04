import { apiFetch, type RequestOptions } from "./client"
import {
  analyticsOverviewSchema,
  type AnalyticsOverviewQuery,
} from "@/lib/contracts/analytics"

export {
  analyticsLocationSchema,
  analyticsOverviewSchema,
  analyticsSeriesPointSchema,
  analyticsSummarySchema,
  providerTotalsSchema,
  type AnalyticsLocation,
  type AnalyticsOverview,
  type AnalyticsSeriesPoint,
  type AnalyticsSummary,
  type ProviderTotals,
} from "@/lib/contracts/analytics"

export function fetchAnalyticsOverview(
  params?: AnalyticsOverviewQuery,
  options?: RequestOptions
) {
  const query = new URLSearchParams()
  if (params?.from) query.set("from", params.from)
  if (params?.to) query.set("to", params.to)
  if (params?.granularity) query.set("granularity", params.granularity)
  // The route reads snake_case for this one; every other analytics param is
  // camelCase, which is exactly the kind of detail a caller should not carry.
  if (params?.clientId) query.set("client_id", params.clientId)
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/analytics/overview${suffix}`, {
    schema: analyticsOverviewSchema,
    ...options,
  })
}
