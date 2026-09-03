import {
  decodeReviewsQuery,
  encodeReviewsCursor,
  InvalidReviewsCursorError,
  type ReviewCapabilities,
  type ReviewsCursor,
} from "@/lib/contracts/reviews"
import { reviewCapabilitiesForLocations } from "@/lib/server/capabilities"
import { ApiError } from "@/lib/server/http"
import { buildInboxQuery } from "@/lib/server/reviews-query"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

const NO_CAPABILITIES = {
  canPublish: false,
  canEdit: false,
  canRequestApproval: false,
} satisfies ReviewCapabilities

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
  handler: async ({ session, query, tenant }) => {
    const rows = await tenant(async (sql) => {
      // The two-person setting decides whether the requester of an approval
      // may also grant it, which is what separates "awaiting my approval"
      // from "awaiting others". Read once per request, not per row.
      const [settings] = await sql<{ requireTwoPersonApproval: boolean }[]>`
        select require_two_person_approval as "requireTwoPersonApproval"
        from organisation
        where id = ${session.organisationId}
      `
      const queried = await buildInboxQuery(sql, {
        ...query,
        role: session.role,
        userId: session.userId,
        canPublish: session.canPublish,
        requireTwoPersonApproval: settings?.requireTwoPersonApproval ?? false,
      })
      const capabilities = await reviewCapabilitiesForLocations(
        sql,
        session,
        queried.map((row) => row.location.id)
      )
      return queried.map((row) => ({
        ...row,
        capabilities: capabilities.get(row.location.id) ?? NO_CAPABILITIES,
      }))
    })
    const hasMore = rows.length > query.pageSize
    const items = hasMore ? rows.slice(0, query.pageSize) : rows
    const last = items.at(-1)
    const nextCursor =
      hasMore && last
        ? encodeReviewsCursor({
            updateTime:
              last.updateTime instanceof Date
                ? last.updateTime.toISOString()
                : last.updateTime,
            id: last.id,
            rating: last.rating,
          } satisfies ReviewsCursor)
        : null
    return { items, nextCursor }
  },
})
