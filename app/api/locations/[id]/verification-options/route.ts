import { z } from "zod"

import { verificationOptionsInputSchema } from "@/lib/contracts/google-verification-options"
import { loadGoogleVerificationOptions } from "@/lib/server/google-verification-options"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
const params = z.object({ id: z.uuid() })

export const GET = route({
  roles: ["owner", "admin"], params,
  query: verificationOptionsInputSchema.omit({ context: true }),
  handler: ({ session, params, query }) => loadGoogleVerificationOptions(session, params.id, query),
})

export const POST = route({
  roles: ["owner", "admin"], params, body: verificationOptionsInputSchema,
  handler: ({ session, params, body }) => loadGoogleVerificationOptions(session, params.id, body),
})
