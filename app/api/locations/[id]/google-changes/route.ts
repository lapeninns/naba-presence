import { z } from "zod"

import type { GoogleChangesResponse } from "@/lib/contracts/google-change-watch"
import { listGoogleChanges } from "@/lib/server/google-change-watch"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** The listing's changes made on Google, from the database; never reads Google. */
export const GET = route({
  params: z.object({ id: z.uuid() }),
  handler: async ({ session, params }) =>
    (await listGoogleChanges(
      session,
      params.id
    )) satisfies GoogleChangesResponse,
})
