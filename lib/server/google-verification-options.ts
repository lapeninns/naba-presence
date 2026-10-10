import "server-only"

import { z } from "zod"

import type { VerificationChoice, VerificationOptionsInput, VerificationOptionsResponse } from "@/lib/contracts/google-verification-options"
import { verificationChoiceDetails } from "@/lib/domain/google-verification-options"
import { getDatabase, withTenant } from "@/lib/server/db"
import { resolveGbpLocationContext, stableGoogleHash } from "@/lib/server/gbp-management"
import { connectionAccessToken, getGoogleLocation, googleVerificationApi } from "@/lib/server/google"
import { verificationFailure } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

const locationSchema = z.object({
  name: z.string(), serviceArea: z.object({ businessType: z.string().optional() }).optional(),
})
const optionsSchema = z.object({ options: z.array(z.unknown()).max(100).optional() })

/** Read-only discovery. Service verification addresses are neither cached nor audited. */
export async function loadGoogleVerificationOptions(session: Session, locationId: string, input: VerificationOptionsInput): Promise<VerificationOptionsResponse> {
  const linked = await withTenant(session.organisationId, (sql) => resolveGbpLocationContext(sql, session, locationId))
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const requestOptions = { connectionKey: linked.connectionId }
  let providerLocation: unknown
  try {
    providerLocation = await getGoogleLocation(token, linked.googleLocationName, ["name", "serviceArea"], requestOptions)
  } catch (error) {
    if (error instanceof ApiError) {
      const safe = verificationFailure(error)
      throw new ApiError(safe.status, safe.code, "Google business type could not be checked. Refresh before supplying a verification address.", { reconnectRequired: safe.reconnectRequired, retryable: safe.retryable })
    }
    throw new ApiError(502, "verification_business_type_unavailable", "Google business type could not be checked. Try again.")
  }
  const location = locationSchema.safeParse(providerLocation)
  if (!location.success || location.data.name !== linked.googleLocationName) throw new ApiError(502, "verification_business_type_unavailable", "Google did not return the selected business identity.")
  const type = location.data.serviceArea?.businessType
  const customerLocationOnly = type === "CUSTOMER_LOCATION_ONLY" ? true : type === "CUSTOMER_AND_BUSINESS_LOCATION" ? false : null
  if (input.context && customerLocationOnly !== true) {
    throw new ApiError(400, "verification_context_not_allowed", "A private verification address can only be supplied for a confirmed customer-locations-only business.")
  }
  let providerOptions: unknown
  try {
    providerOptions = await googleVerificationApi(token, { path: `${linked.googleLocationName}:fetchVerificationOptions`, method: "POST", payload: input }, requestOptions)
  } catch (error) {
    if (error instanceof ApiError) {
      const safe = verificationFailure(error)
      throw new ApiError(safe.status, safe.code, "Google verification options could not be loaded. Refresh or continue in Google.", { reconnectRequired: safe.reconnectRequired, retryable: safe.retryable })
    }
    throw new ApiError(502, "verification_options_unavailable", "Google verification options could not be loaded. Try again.")
  }
  const parsed = optionsSchema.safeParse(providerOptions)
  if (!parsed.success) throw new ApiError(502, "verification_options_unavailable", "Google returned unreadable verification options.")
  const contextHash = stableGoogleHash(input.context ?? null)
  const options: VerificationChoice[] = []
  for (const raw of parsed.data.options ?? []) {
    const details = verificationChoiceDetails(raw)
    if (!details) throw new ApiError(502, "verification_options_unavailable", "Google returned a verification option without a method.")
    const id = stableGoogleHash({ details, contextHash, languageCode: input.languageCode, locationName: linked.googleLocationName })
    if (!options.some((option) => option.id === id)) options.push({ ...details, id })
  }
  return { locationId, googleLocationName: linked.googleLocationName, languageCode: input.languageCode, customerLocationOnly, contextProvided: Boolean(input.context), contextHash, checkedAt: new Date().toISOString(), options }
}
