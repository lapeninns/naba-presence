import "server-only"

import { createHmac, randomBytes } from "node:crypto"
import { z } from "zod"
import type { VerificationCompletionInput } from "@/lib/contracts/google-verification-completion-review"
import { decryptSecret, encryptSecret, secretEqual, sha256 } from "@/lib/server/crypto"
import { ApiError } from "@/lib/server/http"

const privateBindingSchema = z.strictObject({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  commitment: z.string().regex(/^[a-f0-9]{64}$/),
})

function commitment(key: string, input: VerificationCompletionInput) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(JSON.stringify([input.name, input.pin]))
    .digest("hex")
}

/** A random encrypted key protects the low-entropy PIN commitment. The PIN is never encrypted or stored. */
export function bindVerificationPin(input: VerificationCompletionInput) {
  const key = randomBytes(32).toString("hex")
  const privatePayload = encryptSecret(JSON.stringify({ key, commitment: commitment(key, input) }))
  return { privatePayload, credentialBindingHash: sha256(privatePayload) }
}

export function assertVerificationPinBinding(privatePayload: Buffer, expectedHash: string, input?: VerificationCompletionInput) {
  if (!secretEqual(sha256(privatePayload), expectedHash)) throw new ApiError(409, "approval_stale", "The private verification review changed. Generate a new review.")
  let binding: z.infer<typeof privateBindingSchema>
  try { binding = privateBindingSchema.parse(JSON.parse(decryptSecret(privatePayload))) }
  catch (error) {
    if (error instanceof Error) throw new ApiError(409, "approval_stale", "The private verification review could not be restored. Generate a new review.")
    throw error
  }
  if (input && !secretEqual(commitment(binding.key, input), binding.commitment)) throw new ApiError(409, "verification_pin_changed", "The PIN changed after review. Generate a new review before submitting it.")
}
