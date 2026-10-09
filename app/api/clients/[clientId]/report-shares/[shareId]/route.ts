import {
  reportShareParamsSchema,
  type ReportShareRevokedResponse,
} from "@/lib/contracts/report-shares"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { requireClientAccess } from "@/lib/server/permissions"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Revokes a report share link. The row stays (with revoked_at) so the list
 * and the audit trail keep it; lookup_report_share stops answering for it at
 * once. Revoking a link that is already revoked is a no-op, not an error.
 */
export const DELETE = route({
  roles: ["owner", "admin"],
  params: reportShareParamsSchema,
  handler: async ({ session, params, requestId, tenant }) => {
    await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      const [share] = await sql<{ id: string; revoked: boolean }[]>`
        select id::text as id, revoked_at is not null as revoked
        from report_share
        where id = ${params.shareId}
          and client_id = ${params.clientId}
        for update
      `
      if (!share) {
        throw new ApiError(
          404,
          "report_share_not_found",
          "That report link was not found."
        )
      }
      if (share.revoked) return
      await sql`
        update report_share
        set revoked_at = now(),
            revoked_by = ${session.userId}
        where id = ${params.shareId}
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "report_share.revoked",
        subjectType: "report_share",
        subjectId: params.shareId,
        requestId,
        metadata: { clientId: params.clientId },
      })
    })
    return { revoked: true } satisfies ReportShareRevokedResponse
  },
})
