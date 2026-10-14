import { z } from "zod"
import { googleOnboardingDraftSaveSchema } from "@/lib/contracts/google-onboarding"
import { getOnboardingDraft, saveOnboardingDraft } from "@/lib/server/google-onboarding-drafts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ accountId: z.uuid(), draftId: z.uuid() })
export const GET = route({
  maxDuration,
  roles: ["owner", "admin"], params,
  handler: ({ session, params }) => getOnboardingDraft(session, params.accountId, params.draftId),
})
export const PUT = route({
  maxDuration,
  roles: ["owner", "admin"], params, body: googleOnboardingDraftSaveSchema,
  handler: ({ session, params, body, requestId }) => saveOnboardingDraft(session, params.accountId, params.draftId, body, requestId),
})
