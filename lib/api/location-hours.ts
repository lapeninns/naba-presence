import { z } from "zod"

import { apiFetch } from "./client"

export type HoursUpdateMask = "regularHours" | "specialHours" | "moreHours"

const normalizedHoursSchema = z.object({
  regular: z.array(
    z.object({
      dayOfWeek: z.number(),
      isClosed: z.boolean(),
      periods: z.array(z.object({ opensAt: z.string(), closesAt: z.string() })),
    })
  ),
  special: z.array(
    z.object({
      effectiveDate: z.string(),
      isClosed: z.boolean(),
      opensAt: z.string().nullable(),
      closesAt: z.string().nullable(),
    })
  ),
  moreHours: z.array(
    z.object({
      hoursTypeId: z.string(),
      periods: z.array(z.object({ dayOfWeek: z.number(), opensAt: z.string(), closesAt: z.string() })),
    })
  ),
})
export type NormalizedHours = z.infer<typeof normalizedHoursSchema>

const hoursStateSchema = z.object({
  location: z.object({ id: z.string(), name: z.string(), googleLocationName: z.string(), timezone: z.string() }),
  canonicalResource: z.object({ revision: z.string(), updatedAt: z.string() }),
  status: z.enum(["in_sync", "core_dirty", "google_dirty", "conflict"]),
  canonical: normalizedHoursSchema,
  google: normalizedHoursSchema,
  canonicalHash: z.string(),
  googleHash: z.string(),
  updateMask: z.array(z.enum(["regularHours", "specialHours", "moreHours"])),
  warnings: z.array(z.string()),
  canPublish: z.boolean(),
  writesEnabled: z.boolean(),
  lastReconciledAt: z.string().nullable(),
  latestAttempt: z.object({ id: z.string(), status: z.string(), createdAt: z.string(), finishedAt: z.string().nullable() }).nullable(),
})
export type HoursState = z.infer<typeof hoursStateSchema>

export function fetchHours(id: string): Promise<HoursState> {
  return apiFetch(`/api/locations/${id}/hours`, { schema: z.object({ hours: hoursStateSchema }) }).then((r) => r.hours)
}

export function saveHours(id: string, input: { expectedCanonicalRevision: string; hours: NormalizedHours }) {
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "PUT",
    body: input,
    schema: z.object({ saved: z.literal(true), revision: z.string() }),
  })
}

export type PublishHoursInput = {
  expectedCanonicalRevision: string
  expectedCanonicalHash: string
  expectedGoogleHash: string
  approvedUpdateMask: HoursUpdateMask[]
  confirmOverwriteGoogleChanges?: boolean
}
export type PublishResult = { status: string; attemptId?: string; idempotent?: boolean }

export function publishHours(id: string, input: PublishHoursInput): Promise<PublishResult> {
  return apiFetch(`/api/locations/${id}/hours`, {
    method: "POST",
    body: { confirmation: "publish_nabapresence_hours_to_google", ...input },
    schema: z.object({ status: z.string(), attemptId: z.string().optional(), idempotent: z.boolean().optional() }),
  })
}
