import "server-only"

import { z } from "zod"

import { GoogleMutationAmbiguousError } from "@/lib/server/google"
import { ApiError } from "@/lib/server/http"
import { verificationCompletionInputSchema } from "@/lib/contracts/google-verification-completion-review"

const verificationName = z.string().max(512).regex(/^locations\/[A-Za-z0-9_-]+\/verifications\/[A-Za-z0-9_-]+$/)
const methodSchema = z.enum(["VERIFICATION_METHOD_UNSPECIFIED", "ADDRESS", "EMAIL", "PHONE_CALL", "SMS", "AUTO", "VETTED_PARTNER"])
const verificationSchema = z.object({
  name: verificationName.optional(),
  method: methodSchema.optional(),
  state: z.enum(["STATE_UNSPECIFIED", "PENDING", "COMPLETED", "FAILED"]).optional(),
  createTime: z.iso.datetime().optional(),
})
const responseSchema = verificationSchema.extend({ verification: verificationSchema.optional() })
const SAFE_ERROR_CODES: ReadonlySet<string> = new Set([
  "INVALID_ARGUMENT", "FAILED_PRECONDITION", "PERMISSION_DENIED", "NOT_FOUND",
  "RESOURCE_EXHAUSTED", "UNAUTHENTICATED", "UNAVAILABLE", "INTERNAL",
  "google_rate_limited", "google_writes_paused", "google_reconnect_required",
])

/** PINs exist only in the immediate provider request, never in the ledger. */
export function prepareVerificationCompletion(payload: unknown, locationName: string) {
  const parsed = verificationCompletionInputSchema.safeParse(payload)
  if (!parsed.success || !parsed.data.name.startsWith(`${locationName}/verifications/`)) {
    throw new ApiError(400, "invalid_verification_completion", "Supply a verification belonging to this listing and a non-empty PIN of at most 128 characters.")
  }
  return parsed.data
}

/** Allow only typed status/identity fields; unknown response echoes and announcements are not retained. */
export function recordedVerificationResponse(response: unknown) {
  const parsed = responseSchema.safeParse(response)
  if (!parsed.success) throw new GoogleMutationAmbiguousError("Google returned an unreadable verification outcome. Refresh verification status before another attempt.")
  return parsed.data
}

/** Google error messages/details can echo the submitted credential. */
export function verificationFailure(error: unknown): ApiError {
  if (error instanceof GoogleMutationAmbiguousError) {
    return new GoogleMutationAmbiguousError("Google did not confirm the verification outcome. Refresh verification status before another attempt.")
  }
  if (error instanceof ApiError) {
    return new ApiError(error.status, SAFE_ERROR_CODES.has(error.code) ? error.code : "google_verification_failed", "Google did not accept the verification request. Refresh its status and check the eligible method or PIN before trying again.", { retryable: error.retryable, reconnectRequired: error.reconnectRequired })
  }
  return new GoogleMutationAmbiguousError("The verification outcome could not be established. Refresh verification status before another attempt.")
}
