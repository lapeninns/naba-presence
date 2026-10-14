import { z } from "zod"
import { loadGoogleVerificationState } from "@/lib/server/google-verification-state"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60
export const GET = route({ maxDuration, roles: ["owner", "admin"], params: z.object({ id: z.uuid() }),
  handler: ({ session, params }) => loadGoogleVerificationState(session, params.id),
})
