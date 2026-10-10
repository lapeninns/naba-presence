import "server-only"

import { z } from "zod"
import { onboardingServicesResponseSchema } from "@/lib/contracts/google-onboarding-services"
import type { GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { unsupportedServiceIndexes } from "@/lib/domain/google-services"
import { unsupportedOnboardingHoursTypes } from "@/lib/domain/google-onboarding-hours"
import { getDatabase, withTenant } from "./db"
import { connectionAccessToken, googleAccountManagementApi } from "./google"
import { checkedOnboardingDraft } from "./google-onboarding-drafts"
import { ApiError } from "./http"
import { loadGoogleServiceMetadata } from "./service-metadata"
import type { Session } from "./session"

type Target = {
  readonly accountId: string
  readonly draftId: string
  readonly expectedRevision: number
}

export async function getOnboardingServices(session: Session, target: Target) {
  const draft = await withTenant(session.organisationId, (sql) => checkedOnboardingDraft(sql, session, target.accountId, target.draftId))
  if (draft.revision !== target.expectedRevision) throw new ApiError(409, "onboarding_draft_stale", "Restore the latest draft before loading its services.")
  if (!draft.payload.categories?.primaryCategory) throw new ApiError(409, "service_categories_unknown", "Select and save a primary category before loading services.")
  const token = await connectionAccessToken(getDatabase(), session.organisationId, draft.connection_id)
  const access = await googleAccountManagementApi(token, { path: draft.account_name }, { connectionKey: draft.connection_id })
  if (!z.object({ name: z.literal(draft.account_name) }).safeParse(access).success) throw new ApiError(502, "onboarding_account_unconfirmed", "Google did not confirm access to the selected account. Refresh account discovery.")
  const metadata = await loadGoogleServiceMetadata(token, draft.payload, draft.connection_id)
  await withTenant(session.organisationId, async (sql) => {
    const current = await checkedOnboardingDraft(sql, session, target.accountId, target.draftId)
    if (current.revision !== draft.revision || current.payload_hash !== draft.payload_hash) throw new ApiError(409, "onboarding_draft_stale", "The draft changed while loading services. Load services for the saved categories again.")
  })
  return onboardingServicesResponseSchema.parse({ ...metadata, draftId: draft.id, revision: draft.revision, payloadHash: draft.payload_hash })
}

export async function requireOnboardingServiceSupport(token: string, payload: GoogleOnboardingDraft["payload"], connectionId: string) {
  if (!payload.serviceItems?.length && !payload.moreHours?.length) return
  const metadata = await loadGoogleServiceMetadata(token, payload, connectionId)
  const unsupported = unsupportedServiceIndexes(payload.serviceItems ?? [], [], metadata.categories)
  if (unsupported.length) throw new ApiError(422, "onboarding_services_unsupported", `Service ${unsupported[0] + 1} is not supported by the proposed categories. Refresh service choices and review again.`)
  if (payload.moreHours && unsupportedOnboardingHoursTypes(payload.moreHours, metadata.categories).length) throw new ApiError(422, "onboarding_hours_type_unsupported", "An additional hours type is not supported by the proposed categories. Refresh hours choices and review again.")
}
