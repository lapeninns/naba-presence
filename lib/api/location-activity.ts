import { z } from "zod"

import { apiFetch, type RequestOptions } from "./client"

const activityItemSchema = z.object({
  id: z.string(),
  resourceType: z.string(),
  operation: z.string(),
  status: z.string(),
  targetResourceName: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  updateMask: z.array(z.string()),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  actorUserId: z.string(),
  actorDisplayName: z.string().nullable().optional(),
})
export type LocationActivityItem = z.infer<typeof activityItemSchema>

const activityStateSchema = z.object({
  items: z.array(activityItemSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
})
export type LocationActivityState = z.infer<typeof activityStateSchema>

export function fetchLocationActivity(
  id: string,
  params: { page?: number; pageSize?: number } = {},
  options?: RequestOptions
): Promise<LocationActivityState> {
  const query = new URLSearchParams()
  if (params.page) query.set("page", String(params.page))
  if (params.pageSize) query.set("pageSize", String(params.pageSize))
  const suffix = query.size ? `?${query}` : ""
  return apiFetch(`/api/locations/${id}/activity${suffix}`, {
    schema: z.object({ activity: activityStateSchema }),
    ...options,
  }).then((r) => r.activity)
}
