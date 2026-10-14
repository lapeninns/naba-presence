import { z } from "zod"

import type { PrivacyErasurePreviewResponse } from "@/lib/contracts/privacy"
import { ApiError } from "@/lib/server/http"
import {
  previewSubjectMatches,
  type SubjectRequest,
} from "@/lib/server/privacy/fulfil"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

/**
 * What fulfilling a request would touch, read before an owner confirms an
 * erasure (audit R2B-02): counts only, never the reviews themselves. The
 * fulfil PATCH takes `preview.confirmation` back and refuses an erasure
 * whose match set has changed since. Owners only, like the fulfil.
 */
export const GET = route({
  maxDuration,
  roles: ["owner"],
  params: z.object({ id: z.uuid() }),
  handler: async ({ params, tenant }) => {
    const preview = await tenant(async (sql) => {
      const [request] = await sql<SubjectRequest[]>`
        select
          id::text as id,
          subject_reference as "subjectReference",
          pending_review_ids::text[] as "pendingReviewIds"
        from privacy_request
        where id = ${params.id}
      `
      if (!request) {
        throw new ApiError(
          404,
          "privacy_request_not_found",
          "Privacy request not found."
        )
      }
      return previewSubjectMatches(sql, request)
    })
    return { preview } satisfies PrivacyErasurePreviewResponse
  },
})
