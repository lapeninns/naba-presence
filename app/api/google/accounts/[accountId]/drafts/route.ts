import { z } from "zod"
import { googleOnboardingDraftCreateSchema, googleOnboardingDraftListInputSchema } from "@/lib/contracts/google-onboarding"
import { createOnboardingDraft, listOnboardingDrafts } from "@/lib/server/google-onboarding-drafts"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const GET = route({
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid() }),
  query: googleOnboardingDraftListInputSchema,
  handler: ({ session, params, query }) => listOnboardingDrafts(session, params.accountId, query),
})
export const POST = route({
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid() }),
  body: googleOnboardingDraftCreateSchema,
  handler: ({ session, params, body, requestId }) => createOnboardingDraft(session, params.accountId, body, requestId),
})
