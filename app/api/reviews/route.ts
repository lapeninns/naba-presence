import {
  decodeReviewsQuery,
  InvalidReviewsCursorError,
} from "@/lib/contracts/reviews"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"
import { readReviewsPage } from "@/lib/server/review-reads"

export const runtime = "nodejs"

export const GET = route({
  // The wire codec (snake_case comma lists + base64url cursor) lives in the
  // contract; only the invalid-cursor error mapping is a route concern.
  query: (params) => {
    try {
      return decodeReviewsQuery(params)
    } catch (error) {
      if (error instanceof InvalidReviewsCursorError) {
        throw new ApiError(400, "invalid_cursor", error.message)
      }
      throw error
    }
  },
  // The read lives in lib/server/review-reads.ts so the /inbox page's server
  // prefetch of the first page produces exactly what this route answers.
  handler: async ({ session, query, tenant }) =>
    tenant((sql) => readReviewsPage(sql, session, query)),
})
