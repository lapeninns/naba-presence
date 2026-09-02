import { z } from "zod"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import {
  getHoursState,
  publishCanonicalHours,
  saveCanonicalHours,
} from "@/lib/server/hours"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.uuid() })

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
const hoursSchema = z.object({
  regular: z.array(z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    isClosed: z.boolean(),
    periods: z.array(z.object({ opensAt: timeSchema, closesAt: timeSchema })).max(3),
  })).length(7),
  special: z.array(z.object({
    effectiveDate: z.iso.date(),
    isClosed: z.boolean(),
    opensAt: timeSchema.nullable(),
    closesAt: timeSchema.nullable(),
  })).max(366),
  moreHours: z.array(z.object({
    hoursTypeId: z.string().min(1).max(100),
    periods: z.array(z.object({
      dayOfWeek: z.number().int().min(0).max(6),
      opensAt: timeSchema,
      closesAt: timeSchema,
    })).max(21),
  })).max(20),
}).superRefine((hours, context) => {
  if (new Set(hours.regular.map((day) => day.dayOfWeek)).size !== 7) {
    context.addIssue({ code: "custom", message: "Regular hours must contain each day exactly once." })
  }
  for (const [index, day] of hours.regular.entries()) {
    if (day.isClosed !== (day.periods.length === 0)) {
      context.addIssue({ code: "custom", path: ["regular", index], message: "Closed days cannot contain periods and open days require a period." })
    }
  }
  for (const [index, period] of hours.special.entries()) {
    if (!period.isClosed && (!period.opensAt || !period.closesAt)) {
      context.addIssue({ code: "custom", path: ["special", index], message: "Open special hours require opening and closing times." })
    }
  }
})

const saveSchema = z.object({
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  hours: hoursSchema,
})

const publishSchema = z.object({
  confirmation: z.literal("publish_nabapresence_hours_to_google"),
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  expectedCanonicalHash: z.string().length(64),
  expectedGoogleHash: z.string().length(64),
  approvedUpdateMask: z
    .array(z.enum(["regularHours", "specialHours", "moreHours"]))
    .min(1),
  confirmOverwriteGoogleChanges: z.boolean().default(false),
})

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) => ({
    hours: await getHoursState(session, params.id),
  }),
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveSchema,
  handler: ({ session, params, body, requestId }) =>
    saveCanonicalHours({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      hours: body.hours,
      requestId,
    }),
})

export const POST = route({
  params: paramsSchema,
  body: publishSchema,
  handler: ({ session, params, body, requestId }) =>
    publishCanonicalHours({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      expectedCanonicalHash: body.expectedCanonicalHash,
      expectedGoogleHash: body.expectedGoogleHash,
      approvedUpdateMask: body.approvedUpdateMask as GoogleHoursUpdateMask[],
      confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
      requestId,
    }),
})
