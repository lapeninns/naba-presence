import { apiFetch } from "./client"
import type {
  MfaEnrollInput,
  MfaEnrollResponse,
  MfaFactorsResponse,
  MfaStepUpInput,
  MfaStepUpResponse,
  MfaVerifyInput,
  MfaVerifyResponse,
} from "@/lib/contracts/auth"

// Schemas load on demand (see `ResponseSchema` in ./client), as in ./auth:
// the contracts pull in zod, which /sign-in/verify would otherwise download
// before it can render.
const authContract = () => import("@/lib/contracts/auth")

/** The authenticator apps a pending sign-in may answer with. */
export function pendingFactors(): Promise<MfaFactorsResponse> {
  return apiFetch("/api/auth/mfa/factors", {
    schema: () => authContract().then((m) => m.mfaFactorsResponseSchema),
  })
}

/** Checks a code for the pending sign-in or enrollment. */
export function verifyMfaCode(
  input: MfaVerifyInput
): Promise<MfaVerifyResponse> {
  return apiFetch("/api/auth/mfa/verify", {
    method: "POST",
    body: input,
    schema: () => authContract().then((m) => m.mfaVerifyResponseSchema),
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
    schema: () => authContract().then((m) => m.mfaEnrollResponseSchema),
  })
}

/**
 * Renews the signed-in person's two-step proof before a sensitive action
 * (P02-S9). The session cookie is replaced; nothing else changes.
 */
export function stepUpMfa(input: MfaStepUpInput): Promise<MfaStepUpResponse> {
  return apiFetch("/api/auth/mfa/step-up", {
    method: "POST",
    body: input,
    schema: () => authContract().then((m) => m.mfaStepUpResponseSchema),
  })
}
