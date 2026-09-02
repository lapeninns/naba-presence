import { z } from "zod"

import { GOOGLE_PERFORMANCE_METRICS } from "@/lib/domain/google-contract"
import { apiFetch, type RequestOptions } from "./client"

const metricTotalsSchema = z.object(
  Object.fromEntries(GOOGLE_PERFORMANCE_METRICS.map((m) => [m, z.number()]))
) as z.ZodType<Record<(typeof GOOGLE_PERFORMANCE_METRICS)[number], number>>

const metricPartialSchema = z.record(z.string(), z.number())

export const presenceStateSchema = z.enum(["no_link", "ready", "unavailable", "pending", "empty"])

export const presenceResponseSchema = z.object({
  range: z.string(),
  from: z.string(),
  to: z.string(),
  state: presenceStateSchema,
  freshThrough: z.string().nullable(),
  locations: z.array(z.object({ id: z.string(), name: z.string() })),
  totals: metricTotalsSchema,
  series: z.array(z.object({ date: z.string(), metrics: metricPartialSchema })),
  unavailableReasons: z.array(z.string()),
  keywordsEnabled: z.boolean(),
  ingestionEnabled: z.boolean(),
})

export type PresenceStatus = z.infer<typeof presenceStateSchema>
export type PresenceResponse = z.infer<typeof presenceResponseSchema>

export function fetchPresence(
  params: { range: string; locationId?: string },
  options?: RequestOptions
) {
  const query = new URLSearchParams({ range: params.range })
  if (params.locationId) query.set("locationId", params.locationId)
  return apiFetch(`/api/analytics/presence?${query}`, {
    schema: presenceResponseSchema,
    ...options,
  })
}
