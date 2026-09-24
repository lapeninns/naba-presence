import {
  organisationRenameSchema,
  type OrganisationRenamedResponse,
  type OrganisationSummary,
  type OrganisationsResponse,
} from "@/lib/contracts/session"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
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

/**
 * Renames the session's organisation. Owner-only: the name is what every
 * member sees in the sidebar and what invitations say they are joining.
 * Sign-up stores a placeholder ("<name>'s organisation"), so this is how an
 * agency gets its real name. The slug is left alone; nothing user-facing
 * reads it and changing it would break nothing but gain nothing.
 */
export const PATCH = route({
  roles: ["owner"],
  body: organisationRenameSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    const organisation = await tenant(async (sql) => {
      const [row] = await sql<{ organisationId: string; name: string }[]>`
        update organisation
        set name = ${body.name}
        where id = ${session.organisationId}
        returning id::text as "organisationId", name
      `
      if (!row) {
        throw new ApiError(
          404,
          "organisation_not_found",
          "Organisation not found."
        )
      }
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "organisation.renamed",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId,
        metadata: {
          previousName: session.organisationName,
          name: row.name,
          clientRequestId,
        },
      })
      return row
    })
    return { organisation } satisfies OrganisationRenamedResponse
  },
})
