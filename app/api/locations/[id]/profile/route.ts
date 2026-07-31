import { NextResponse } from "next/server"
import { z } from "zod"

import { PROFILE_FIELD_KEYS } from "@/lib/domain/profile"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import {
  getProfileState,
  importProfileFromGoogle,
  publishProfileToGoogle,
  saveCanonicalProfile,
} from "@/lib/server/profile"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const saveSchema = z.object({
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  values: z.object({
    name: z.string().max(255).nullable().optional(),
    description: z.string().max(750).nullable().optional(),
    phone: z.string().max(50).nullable().optional(),
    website: z.url().max(2048).nullable().optional(),
  }),
})

const operationSchema = z.object({
  direction: z.enum(["to_google", "from_google"]),
  confirmation: z.enum([
    "publish_nabapresence_profile_to_google",
    "import_google_profile_to_nabapresence",
  ]),
  selectedFields: z.array(z.enum(PROFILE_FIELD_KEYS)).min(1),
  expectedCanonicalRevision: z.string().regex(/^\d+$/),
  expectedCanonicalHash: z.string().length(64),
  expectedGoogleHash: z.string().length(64),
  confirmOverwriteGoogleChanges: z.boolean().default(false),
  confirmOverwriteCanonicalChanges: z.boolean().default(false),
})

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession()
    const { id } = await params
    return NextResponse.json({
      profile: await getProfileState(session, z.uuid().parse(id)),
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
      await saveCanonicalProfile({
        session,
        locationId: z.uuid().parse(id),
        expectedCanonicalRevision: input.expectedCanonicalRevision,
        values: input.values,
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
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const { id } = await params
    const locationId = z.uuid().parse(id)
    const input = operationSchema.parse(await request.json())
    if (
      input.direction === "to_google" &&
      input.confirmation !== "publish_nabapresence_profile_to_google"
    ) {
      throw new ApiError(
        400,
        "profile_confirmation_invalid",
        "The profile operation confirmation does not match its direction."
      )
    }
    if (
      input.direction === "from_google" &&
      input.confirmation !== "import_google_profile_to_nabapresence"
    ) {
      throw new ApiError(
        400,
        "profile_confirmation_invalid",
        "The profile operation confirmation does not match its direction."
      )
    }
    const result =
      input.direction === "to_google"
        ? await publishProfileToGoogle({
            session,
            locationId,
            selectedFields: input.selectedFields,
            expectedCanonicalRevision: input.expectedCanonicalRevision,
            expectedCanonicalHash: input.expectedCanonicalHash,
            expectedGoogleHash: input.expectedGoogleHash,
            confirmOverwriteGoogleChanges:
              input.confirmOverwriteGoogleChanges,
            requestId: rid.id,
          })
        : await importProfileFromGoogle({
            session,
            locationId,
            selectedFields: input.selectedFields,
            expectedCanonicalRevision: input.expectedCanonicalRevision,
            expectedCanonicalHash: input.expectedCanonicalHash,
            expectedGoogleHash: input.expectedGoogleHash,
            confirmOverwriteCanonicalChanges:
              input.confirmOverwriteCanonicalChanges,
            requestId: rid.id,
          })
    return NextResponse.json(result)
  } catch (error) {
    return apiError(error)
  }
}
