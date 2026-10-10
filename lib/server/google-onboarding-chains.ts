import "server-only"

import { z } from "zod"
import { onboardingChainsResponseSchema, type OnboardingChainsQuery } from "@/lib/contracts/google-onboarding-chains"
import { chainSearchChoices } from "@/lib/domain/google-chains"
import { getDatabase, withTenant } from "./db"
import { connectionAccessToken, googleAccountManagementApi, searchGoogleChains } from "./google"
import { checkedOnboardingDraft } from "./google-onboarding-drafts"
import { ApiError } from "./http"
import type { Session } from "./session"

export async function searchOnboardingChains(session: Session, accountId: string, draftId: string, input: OnboardingChainsQuery) {
  const draft = await withTenant(session.organisationId, (sql) => checkedOnboardingDraft(sql, session, accountId, draftId))
  if (draft.revision !== input.expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "Restore the latest draft before searching chains.")
  const token = await connectionAccessToken(getDatabase(), session.organisationId, draft.connection_id)
  const access = await googleAccountManagementApi(token, { path: draft.account_name }, { connectionKey: draft.connection_id })
  if (!z.object({ name: z.literal(draft.account_name) }).safeParse(access).success) throw new ApiError(502, "onboarding_account_unconfirmed", "Google did not confirm access to this account. Refresh account discovery.")
  const response = await searchGoogleChains(token, input.query, { connectionKey: draft.connection_id })
  const choices = chainSearchChoices(response)
  if (!choices || choices.length > 100) throw new ApiError(502, "onboarding_chains_invalid", "Google returned incomplete chain results. Retry the search.")
  await withTenant(session.organisationId, async (sql) => {
    const current = await checkedOnboardingDraft(sql, session, accountId, draftId)
    if (current.revision !== draft.revision || current.payload_hash !== draft.payload_hash) throw new ApiError(409, "onboarding_draft_stale", "The draft changed during chain search. Search again using the saved draft.")
  })
  return onboardingChainsResponseSchema.parse({ draftId: draft.id, revision: draft.revision, payloadHash: draft.payload_hash, query: input.query, choices })
}
