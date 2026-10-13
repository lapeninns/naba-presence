import { reviewIdParamsSchema } from "@/lib/contracts/reviews"
import { route } from "@/lib/server/route"
import { readReviewDetail } from "@/lib/server/review-reads"

export const runtime = "nodejs"

// The read lives in lib/server/review-reads.ts so the /inbox page's server
// prefetch of `?selected=` produces the same review this route answers.
export const GET = route({
  params: reviewIdParamsSchema,
  handler: async ({ session, params, tenant }) => {
    const review = await tenant((sql) =>
      readReviewDetail(sql, session, params.id)
    )
    return { review }
  },
})
