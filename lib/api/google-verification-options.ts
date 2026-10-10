import { verificationOptionsResponseSchema, type VerificationOptionsInput } from "@/lib/contracts/google-verification-options"
import { apiFetch, type RequestOptions } from "./client"

export function fetchGoogleVerificationOptions(locationId: string, input: VerificationOptionsInput, options?: RequestOptions) {
  return apiFetch(`/api/locations/${locationId}/verification-options`, {
    ...options, method: "POST", body: input, schema: verificationOptionsResponseSchema,
  })
}
