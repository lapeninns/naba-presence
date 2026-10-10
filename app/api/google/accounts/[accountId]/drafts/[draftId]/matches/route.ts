import { z } from "zod"
import { googleOnboardingDraftMatchSchema } from "@/lib/contracts/google-onboarding"
import { matchOnboardingDraft } from "@/lib/server/google-onboarding-drafts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const POST = route({
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  body: googleOnboardingDraftMatchSchema,
  handler: ({ session, params, body, requestId }) => matchOnboardingDraft(session, params.accountId, params.draftId, body.expectedRevision, requestId),
})
