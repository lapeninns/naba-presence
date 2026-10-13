// Request contract for previewing a lodging change set (PUT
// /api/locations/[id]/industry). Kept apart from `./gbp-change-set` because it
// validates against the Google lodging discovery schema, and the change-set
// shape itself is read by client code on every listing page.
import { z } from "zod"

import { GOOGLE_LODGING_UPDATE_PATHS } from "@/lib/domain/google-lodging"
import { lodgingSchema } from "./google-lodging"

export const lodgingUpdateMaskSchema = z.array(z.string().refine((path) => GOOGLE_LODGING_UPDATE_PATHS.has(path), "Select a supported writable lodging field.")).min(1)

export const lodgingPreviewRequestSchema = z.object({
  expectedGoogleHash: z.string().length(64),
  payload: lodgingSchema,
  updateMask: lodgingUpdateMaskSchema,
})
