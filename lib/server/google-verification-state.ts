import "server-only"

import type { ObservedVerification, VerificationStateResponse } from "@/lib/contracts/google-verification-state"
import { merchantVerificationState, verificationStatePage } from "@/lib/domain/google-verification-state"
import { getDatabase, withTenant } from "@/lib/server/db"
import { resolveGbpLocationContext } from "@/lib/server/gbp-management"
import { connectionAccessToken, googleVerificationApi } from "@/lib/server/google"
import { verificationFailure } from "@/lib/server/google-verification-transient"
import { ApiError } from "@/lib/server/http"
import type { Session } from "@/lib/server/session"

export async function currentVerificationContext(session: Session, locationId: string, options: { readonly requireActiveConnection?: boolean } = {}) {
  return withTenant(session.organisationId, async (sql) => {
    const linked = await resolveGbpLocationContext(sql, session, locationId)
    const [member] = await sql<{ readonly role: string }[]>`select role from member where user_id = ${session.userId}`
    if (!member || (member.role !== "owner" && member.role !== "admin")) throw new ApiError(403, "verification_access_changed", "Your access changed. Refresh before checking verification again.")
    const [connection] = await sql<{ readonly status: string; readonly generation: number; readonly active: boolean }[]>`
      select c.status, c.credential_generation as generation, a.is_active as active
      from google_connection c join google_account a on a.google_connection_id = c.id
      where c.id = ${linked.connectionId} and a.id = ${linked.googleAccountId}
    `
    if (!connection || (options.requireActiveConnection !== false && (!connection.active || (connection.status !== "active" && connection.status !== "expired")))) throw new ApiError(409, "google_reconnect_required", "The Google connection or account changed. Reconnect or refresh before checking verification.")
    return { ...linked, credentialGeneration: connection.generation }
  })
}

/** Independent read-only observation. No private provider echoes or credentials are cached. */
export async function loadGoogleVerificationState(session: Session, locationId: string): Promise<VerificationStateResponse> {
  const linked = await currentVerificationContext(session, locationId)
  const token = await connectionAccessToken(getDatabase(), session.organisationId, linked.connectionId)
  const options = { connectionKey: linked.connectionId }
  // These accumulators bound and validate the complete provider pagination chain.
  const verifications: ObservedVerification[] = []
  const names = new Set<string>()
  const tokens = new Set<string>()
  let pageToken: string | null = null
  for (let pageNumber = 0; ; pageNumber++) {
    if (pageNumber >= 20) throw new ApiError(502, "verification_state_incomplete", "Google verification history exceeded the safe refresh limit. Continue in Google.")
    const query = new URLSearchParams({ pageSize: "100" })
    if (pageToken) query.set("pageToken", pageToken)
    let raw: unknown
    try { raw = await googleVerificationApi(token, { path: `${linked.googleLocationName}/verifications?${query}` }, options) }
    catch (error) {
      if (error instanceof ApiError) {
        const safe = verificationFailure(error)
        throw new ApiError(safe.status, safe.code, "Google verification history could not be refreshed. Try again or continue in Google.", { retryable: safe.retryable, reconnectRequired: safe.reconnectRequired })
      }
      throw new ApiError(502, "verification_state_unavailable", "Google verification history could not be refreshed. Try again.")
    }
    const page = verificationStatePage(raw, linked.googleLocationName)
    if (!page) throw new ApiError(502, "verification_state_unavailable", "Google returned unreadable verification history for this listing.")
    for (const item of page.verifications) {
      if (names.has(item.name)) throw new ApiError(502, "verification_state_incomplete", "Google returned duplicate verification identities. Refresh again.")
      names.add(item.name)
      verifications.push(item)
    }
    pageToken = page.nextPageToken
    if (!pageToken) break
    if (tokens.has(pageToken)) throw new ApiError(502, "verification_state_incomplete", "Google verification pagination repeated. Refresh again.")
    tokens.add(pageToken)
  }
  let merchant: VerificationStateResponse["merchant"] = null
  try { merchant = merchantVerificationState(await googleVerificationApi(token, { path: `${linked.googleLocationName}/VoiceOfMerchantState` }, options)) }
  catch (error) {
    if (!(error instanceof Error)) throw error
    // A readable verification history remains useful when this separate provider read fails.
  }
  const current = await currentVerificationContext(session, locationId)
  if (current.googleLocationName !== linked.googleLocationName || current.connectionId !== linked.connectionId || current.googleAccountId !== linked.googleAccountId || current.credentialGeneration !== linked.credentialGeneration) throw new ApiError(409, "google_target_changed", "The linked Google business changed during refresh. Refresh again.")
  return { locationId, googleLocationName: linked.googleLocationName, checkedAt: new Date().toISOString(), verifications, merchant, merchantError: merchant ? null : "verification_merchant_state_unavailable" }
}
