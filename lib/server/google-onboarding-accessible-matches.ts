import "server-only"

import { z } from "zod"
import { googleAccountMatchesResponseSchema } from "@/lib/contracts/google-onboarding"
import { onboardingAccessibleMatchesResponseSchema, type OnboardingAccessibleLocation, type OnboardingAccessibleMatchesQuery } from "@/lib/contracts/google-onboarding-accessible-matches"
import { correlateOnboardingMatch, onboardingAccessibleLocationsPageSchema } from "@/lib/domain/google-onboarding-accessible-matches"
import { getDatabase, withTenant } from "./db"
import { connectionAccessToken, googleAccountManagementApi, googleLocations } from "./google"
import { checkedOnboardingDraft, requireEditableOnboardingDraft } from "./google-onboarding-drafts"
import { ApiError } from "./http"
import type { Session } from "./session"

export async function discoverOnboardingAccessibleMatches(session: Session, accountId: string, draftId: string, input: OnboardingAccessibleMatchesQuery) {
  const draft = await withTenant(session.organisationId, async (sql) => {
    const row = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    return row
  })
  if (draft.revision !== input.expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "Restore the latest draft before discovering accessible matches.")
  const result = googleAccountMatchesResponseSchema.safeParse(draft.match_result)
  if (!result.success || !draft.match_request_id || result.data.checkedAt !== input.expectedMatchCheckedAt
    || result.data.accountId !== accountId || result.data.connectionId !== draft.connection_id
    || Date.now() - Date.parse(result.data.checkedAt) >= 24 * 60 * 60 * 1000 || Date.parse(result.data.checkedAt) > Date.now()
    || new Set(result.data.matches.map((match) => match.name)).size !== result.data.matches.length) {
    throw new ApiError(409, "onboarding_matches_stale", "Search for matches again before discovering account access.")
  }
  const token = await connectionAccessToken(getDatabase(), session.organisationId, draft.connection_id)
  const access = await googleAccountManagementApi(token, { path: draft.account_name }, { connectionKey: draft.connection_id })
  if (!z.object({ name: z.literal(draft.account_name) }).safeParse(access).success) throw new ApiError(502, "onboarding_account_unconfirmed", "Google did not confirm access to this account. Refresh account discovery.")
  const locations: OnboardingAccessibleLocation[] = []
  const names = new Set<string>()
  const tokens = new Set<string>()
  let pageToken: string | undefined
  for (let page = 0; page < 100; page++) {
    const response = onboardingAccessibleLocationsPageSchema.safeParse(await googleLocations(token, draft.account_name, pageToken, { connectionKey: draft.connection_id }))
    if (!response.success) throw new ApiError(502, "onboarding_accessible_locations_invalid", "Google returned incomplete location identities. Retry account discovery.")
    for (const location of response.data.locations ?? []) {
      if (names.has(location.name)) throw new ApiError(502, "onboarding_accessible_locations_invalid", "Google repeated a location during discovery. Retry account discovery.")
      names.add(location.name)
      locations.push({ name: location.name, ...(location.title !== undefined ? { title: location.title } : {}), ...(location.metadata?.placeId ? { placeId: location.metadata.placeId } : {}) })
    }
    pageToken = response.data.nextPageToken || undefined
    if (!pageToken) break
    if (tokens.has(pageToken) || page === 99) throw new ApiError(502, "onboarding_accessible_locations_incomplete", "Account discovery did not finish. Retry before choosing a match.")
    tokens.add(pageToken)
  }
  await withTenant(session.organisationId, async (sql) => {
    const current = await checkedOnboardingDraft(sql, session, accountId, draftId)
    await requireEditableOnboardingDraft(sql, draftId)
    if (current.revision !== draft.revision || current.payload_hash !== draft.payload_hash || current.connection_id !== draft.connection_id || current.client_id !== draft.client_id) throw new ApiError(409, "onboarding_draft_stale", "The draft changed during discovery. Restore it and search again.")
    if (current.match_request_id !== draft.match_request_id || current.match_result?.checkedAt !== result.data.checkedAt) throw new ApiError(409, "onboarding_match_superseded", "A newer search started during discovery. Refresh to see its result.")
  })
  return onboardingAccessibleMatchesResponseSchema.parse({
    draftId, revision: draft.revision, payloadHash: draft.payload_hash, matchCheckedAt: result.data.checkedAt,
    observedAt: new Date().toISOString(), matches: result.data.matches.map((match) => correlateOnboardingMatch(match, locations)),
  })
}
