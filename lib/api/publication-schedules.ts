import type { z } from "zod"

import {
  occurrencesResponseSchema,
  scheduleResponseSchema,
  schedulesResponseSchema,
  type scheduleDraftSchema,
  type scheduleRevisionSchema,
} from "@/lib/contracts/publication-schedules"

import { apiFetch, type RequestOptions } from "./client"

const base = (locationId: string) => `/api/locations/${locationId}/post-schedules`
export const fetchPostSchedules = (locationId: string, options?: RequestOptions) =>
  apiFetch(base(locationId), { schema: schedulesResponseSchema, ...options }).then((result) => result.schedules)
export const createPostSchedule = (locationId: string, body: z.input<typeof scheduleDraftSchema>) =>
  apiFetch(base(locationId), { method: "POST", body, schema: scheduleResponseSchema }).then((result) => result.schedule)
export const revisePostSchedule = (locationId: string, scheduleId: string, body: z.input<typeof scheduleRevisionSchema>) =>
  apiFetch(`${base(locationId)}/${scheduleId}`, { method: "PUT", body, schema: scheduleResponseSchema }).then((result) => result.schedule)
export const approvePostSchedule = (locationId: string, scheduleId: string, expectedPayloadHash: string, revision: number) =>
  apiFetch(`${base(locationId)}/${scheduleId}/approve`, { method: "POST", body: { expectedPayloadHash, revision }, schema: scheduleResponseSchema }).then((result) => result.schedule)
export const actOnPostSchedule = (locationId: string, scheduleId: string, action: "pause" | "resume" | "cancel") =>
  apiFetch(`${base(locationId)}/${scheduleId}`, { method: "PATCH", body: { action }, schema: scheduleResponseSchema }).then((result) => result.schedule)
export function fetchScheduleOccurrences(query: { from: string; to: string; clientId?: string; locationId?: string }, options?: RequestOptions) {
  const params = new URLSearchParams(Object.entries(query).filter((entry): entry is [string, string] => Boolean(entry[1])))
  return apiFetch(`/api/post-schedules/occurrences?${params}`, { schema: occurrencesResponseSchema, ...options }).then((result) => result.occurrences)
}
