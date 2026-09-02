import { z } from "zod"

import {
  PROFILE_OPERATION_CONFIRMATIONS,
  profileOperationBodySchema,
  saveProfileBodySchema,
  type ProfileOperationResponse,
  type ProfileResponse,
  type SaveProfileResponse,
} from "@/lib/contracts/location-profile"
import { ApiError } from "@/lib/server/http"
import {
  getProfileState,
  importProfileFromGoogle,
  publishProfileToGoogle,
  saveCanonicalProfile,
} from "@/lib/server/profile"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const paramsSchema = z.object({ id: z.uuid() })

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) =>
    ({ profile: await getProfileState(session, params.id) }) satisfies ProfileResponse,
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveProfileBodySchema,
  handler: async ({ session, params, body, requestId }) =>
    (await saveCanonicalProfile({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      values: body.values,
      requestId,
    })) satisfies SaveProfileResponse,
})

export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: profileOperationBodySchema,
  handler: async ({ session, params, body, requestId }) => {
    if (body.confirmation !== PROFILE_OPERATION_CONFIRMATIONS[body.direction]) {
      throw new ApiError(
        400,
        "profile_confirmation_invalid",
        "The profile operation confirmation does not match its direction."
      )
    }
    const result =
      body.direction === "to_google"
        ? await publishProfileToGoogle({
            session,
            locationId: params.id,
            selectedFields: body.selectedFields,
            expectedCanonicalRevision: body.expectedCanonicalRevision,
            expectedCanonicalHash: body.expectedCanonicalHash,
            expectedGoogleHash: body.expectedGoogleHash,
            confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
            requestId,
          })
        : await importProfileFromGoogle({
            session,
            locationId: params.id,
            selectedFields: body.selectedFields,
            expectedCanonicalRevision: body.expectedCanonicalRevision,
            expectedCanonicalHash: body.expectedCanonicalHash,
            expectedGoogleHash: body.expectedGoogleHash,
            confirmOverwriteCanonicalChanges: body.confirmOverwriteCanonicalChanges,
            requestId,
          })
    return result satisfies ProfileOperationResponse
  },
})
