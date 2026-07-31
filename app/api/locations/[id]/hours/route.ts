import { NextResponse } from "next/server"
import { z } from "zod"

import type { GoogleHoursUpdateMask } from "@/lib/domain/google-contract"
import {
  getHoursState,
  publishCanonicalHours,
  saveCanonicalHours,
} from "@/lib/server/hours"
import { apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

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

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({
      hours: await getHoursState(session, z.uuid().parse(id)),
    })
  } catch (error) {
    return apiError(error)
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const input = saveSchema.parse(await request.json())
    return NextResponse.json(
      await saveCanonicalHours({
        session,
        locationId: z.uuid().parse(id),
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        hours: input.hours,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const rid = serverRequestId(request)
    const session = await requireSession()
    const { id } = await params
    const input = publishSchema.parse(await request.json())
    return NextResponse.json(
      await publishCanonicalHours({
        session,
        locationId: z.uuid().parse(id),
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        expectedCanonicalHash: input.expectedCanonicalHash,
        expectedGoogleHash: input.expectedGoogleHash,
        approvedUpdateMask:
          input.approvedUpdateMask as GoogleHoursUpdateMask[],
        confirmOverwriteGoogleChanges:
          input.confirmOverwriteGoogleChanges,
        requestId: rid.id,
      })
    )
  } catch (error) {
    return apiError(error)
  }
}
