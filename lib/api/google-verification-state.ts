import { verificationStateResponseSchema } from "@/lib/contracts/google-verification-state"
import { apiFetch, type RequestOptions } from "./client"

export function fetchGoogleVerificationState(locationId: string, options?: RequestOptions) {
  return apiFetch(`/api/locations/${locationId}/verification-state`, { ...options, schema: verificationStateResponseSchema })
}
