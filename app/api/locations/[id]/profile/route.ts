import { z } from "zod"

import { editorRefreshQuerySchema } from "@/lib/contracts/editor-freshness"
import {
  PROFILE_OPERATION_CONFIRMATIONS,
  profileOperationBodySchema,
  saveProfileBodySchema,
  type ProfileOperationResponse,
  type ProfileResponse,
  type SaveProfileResponse,
} from "@/lib/contracts/location-profile"
import { ApiError } from "@/lib/server/http"
import { submitListingChange } from "@/lib/server/listing-change-registry"
import { invalidatePendingListingChanges } from "@/lib/server/listing-changes"
import {
  getProfileState,
  importProfileFromGoogle,
  saveCanonicalProfile,
} from "@/lib/server/profile"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
// The publish POST does a live Google read, a validateOnly PATCH, the real
// PATCH and a read-back; the platform default would cut it off mid-write.
export const maxDuration = 60

const paramsSchema = z.object({ id: z.uuid() })

// Within the editor's staleness budget the stored observation answers
// (read only, no Google call); `?refresh=1` reads Google now.
export const GET = route({
  maxDuration,
  params: paramsSchema,
  query: editorRefreshQuerySchema,
  handler: async ({ session, params, query }) =>
    ({
      profile: await getProfileState(session, params.id, {
        refresh: query.refresh === "1",
      }),
    }) satisfies ProfileResponse,
})

export const PUT = route({
  maxDuration,
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveProfileBodySchema,
  handler: async ({ session, params, body, requestId }) => {
    const saved = await saveCanonicalProfile({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      values: body.values,
      requestId,
    })
    // A publish waiting for approval was for the profile before this save.
    await invalidatePendingListingChanges({
      organisationId: session.organisationId,
      locationId: params.id,
      kinds: ["profile_publish"],
    })
    // The saved copy against the Google state last observed, whatever its
    // age: the editor publishes from it without fetching again, and the
    // publish compares it with a live read anyway.
    const profile = await getProfileState(session, params.id, {
      maxAgeMs: Infinity,
    })
    return { ...saved, profile } satisfies SaveProfileResponse
  },
})

export const POST = route({
  maxDuration,
  mfa: "step_up",
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
    // A publish parks for a second publisher in two-person mode
    // (lib/server/listing-change-registry.ts); an import only changes
    // NabaPresence's own copy and is never held.
    const result =
      body.direction === "to_google"
        ? await submitListingChange("profile_publish", {
            session,
            locationId: params.id,
            body,
            requestId,
          })
        : await importProfileFromGoogle({
            session,
            locationId: params.id,
            selectedFields: body.selectedFields,
            expectedCanonicalRevision: body.expectedCanonicalRevision,
            expectedCanonicalHash: body.expectedCanonicalHash,
            expectedGoogleHash: body.expectedGoogleHash,
            confirmOverwriteCanonicalChanges:
              body.confirmOverwriteCanonicalChanges,
            requestId,
          })
    return result satisfies ProfileOperationResponse | Response
  },
})
