import { z } from "zod"
import { googleOnboardingLinkSchema } from "@/lib/contracts/google-onboarding"
import { linkOnboardingCreation } from "@/lib/server/google-onboarding-creation"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const POST = route({
  maxDuration,
  mfa: "step_up",
  roles: ["owner", "admin"], params: z.object({ accountId: z.uuid(), draftId: z.uuid() }),
  body: googleOnboardingLinkSchema,
  handler: ({ session, params, body, requestId }) => linkOnboardingCreation(session, params.accountId, params.draftId, body.localName, requestId),
})
