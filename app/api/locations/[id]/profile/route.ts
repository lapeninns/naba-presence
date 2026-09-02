import { z } from "zod"

import { PROFILE_FIELD_KEYS } from "@/lib/domain/profile"
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

export const GET = route({
  params: paramsSchema,
  handler: async ({ session, params }) => ({
    profile: await getProfileState(session, params.id),
  }),
})

export const PUT = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: saveSchema,
  handler: ({ session, params, body, requestId }) =>
    saveCanonicalProfile({
      session,
      locationId: params.id,
      expectedCanonicalRevision: body.expectedCanonicalRevision,
      values: body.values,
      requestId,
    }),
})

export const POST = route({
  roles: ["owner", "admin"],
  params: paramsSchema,
  body: operationSchema,
  handler: ({ session, params, body, requestId }) => {
    if (
      body.direction === "to_google" &&
      body.confirmation !== "publish_nabapresence_profile_to_google"
    ) {
      throw new ApiError(
        400,
        "profile_confirmation_invalid",
        "The profile operation confirmation does not match its direction."
      )
    }
    if (
      body.direction === "from_google" &&
      body.confirmation !== "import_google_profile_to_nabapresence"
    ) {
      throw new ApiError(
        400,
        "profile_confirmation_invalid",
        "The profile operation confirmation does not match its direction."
      )
    }
    return body.direction === "to_google"
      ? publishProfileToGoogle({
          session,
          locationId: params.id,
          selectedFields: body.selectedFields,
          expectedCanonicalRevision: body.expectedCanonicalRevision,
          expectedCanonicalHash: body.expectedCanonicalHash,
          expectedGoogleHash: body.expectedGoogleHash,
          confirmOverwriteGoogleChanges: body.confirmOverwriteGoogleChanges,
          requestId,
        })
      : importProfileFromGoogle({
          session,
          locationId: params.id,
          selectedFields: body.selectedFields,
          expectedCanonicalRevision: body.expectedCanonicalRevision,
          expectedCanonicalHash: body.expectedCanonicalHash,
          expectedGoogleHash: body.expectedGoogleHash,
          confirmOverwriteCanonicalChanges: body.confirmOverwriteCanonicalChanges,
          requestId,
        })
  },
})
