import type {
  OrganisationSummary,
  OrganisationsResponse,
} from "@/lib/contracts/session"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session, tenant }) => {
    const items = await tenant(
      (sql) => sql<OrganisationSummary[]>`
        select
          organisation_id::text as "organisationId",
          name,
          role
        from list_user_organisations(${session.userId})
      `
    )
    return { items } satisfies OrganisationsResponse
  },
})
