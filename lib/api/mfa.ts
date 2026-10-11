import { apiFetch } from "./client"
import {
  mfaEnrollResponseSchema,
  mfaFactorsResponseSchema,
  mfaVerifyResponseSchema,
  type MfaEnrollInput,
  type MfaEnrollResponse,
  type MfaFactorsResponse,
  type MfaVerifyInput,
  type MfaVerifyResponse,
} from "@/lib/contracts/auth"

/** The authenticator apps a pending sign-in may answer with. */
export function pendingFactors(): Promise<MfaFactorsResponse> {
  return apiFetch("/api/auth/mfa/factors", {
    schema: mfaFactorsResponseSchema,
  })
}

/** Checks a code for the pending sign-in or enrollment. */
export function verifyMfaCode(
  input: MfaVerifyInput
): Promise<MfaVerifyResponse> {
  return apiFetch("/api/auth/mfa/verify", {
    method: "POST",
    body: input,
    schema: mfaVerifyResponseSchema,
  })
}

/** Abandons the pending sign-in or enrollment. */
export async function cancelMfa(): Promise<void> {
  await apiFetch("/api/auth/mfa/verify", { method: "DELETE" })
}

/** Starts enrolling an authenticator app (the first, or the backup). */
export function startMfaEnrollment(
  input: MfaEnrollInput
): Promise<MfaEnrollResponse> {
  return apiFetch("/api/auth/mfa/enroll", {
    method: "POST",
    body: input,
    schema: mfaEnrollResponseSchema,
  })
}
