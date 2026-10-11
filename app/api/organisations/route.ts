import {
  organisationUpdateSchema,
  type OrganisationModeChangedResponse,
  type OrganisationRenamedResponse,
  type OrganisationSummary,
  type OrganisationsResponse,
} from "@/lib/contracts/session"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { isOrgFeatureEnabled } from "@/lib/server/org-features"
import { route } from "@/lib/server/route"
import { changeWorkspaceMode } from "@/lib/server/workspace-mode"

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
 * Renames the session's organisation, or switches its workspace mode; one
 * per request. Owner-only.
 *
 * Rename: the name is what every member sees in the sidebar and what
 * invitations say they are joining. Sign-up stores a placeholder ("<name>'s
 * organisation"), so this is how an agency gets its real name. The slug is
 * left alone; nothing user-facing reads it and changing it would break
 * nothing but gain nothing.
 *
 * Mode change ({ workspaceMode }): ships dark behind the organisation's
 * `workspace_mode_change` feature. The rules live in
 * lib/server/workspace-mode.ts; a refused agency-to-business change (more
 * than one active client) is a 409 that names the count, and so is one that
 * would widen live report share links until `confirmReportShares` is sent.
 */
export const PATCH = route({
  roles: ["owner"],
  body: organisationUpdateSchema,
  handler: async ({ session, body, requestId, clientRequestId, tenant }) => {
    if ("workspaceMode" in body) {
      const change = await tenant(async (sql) => {
        if (
          !(await isOrgFeatureEnabled(
            sql,
            session.organisationId,
            "workspace_mode_change"
          ))
        ) {
          throw new ApiError(
            403,
            "workspace_mode_change_unavailable",
            "Changing between a business and an agency workspace is not available for this account yet."
          )
        }
        return changeWorkspaceMode(sql, {
          organisationId: session.organisationId,
          actorUserId: session.userId,
          workspaceMode: body.workspaceMode,
          confirmReportShares: body.confirmReportShares,
          requestId,
          clientRequestId,
        })
      })
      return {
        organisation: {
          organisationId: session.organisationId,
          workspaceMode: change.workspaceMode,
        },
        changed: change.changed,
        refiledLocations: change.refiledLocations,
      } satisfies OrganisationModeChangedResponse
    }
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
      // The hidden home client mirrors the organisation name so the two never
      // drift apart (only business-mode organisations have a home client).
      await sql`
        update client set name = ${row.name}
        where organisation_id = ${session.organisationId} and is_home
      `
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
