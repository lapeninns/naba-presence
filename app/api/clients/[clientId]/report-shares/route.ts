import { NextResponse } from "next/server"

import { clientIdParamsSchema } from "@/lib/contracts/clients"
import {
  reportShareCreateSchema,
  type ReportShareCreatedResponse,
  type ReportSharesResponse,
} from "@/lib/contracts/report-shares"
import { writeAudit } from "@/lib/server/audit"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { requireClientAccess } from "@/lib/server/permissions"
import {
  createReportShareToken,
  reportShareColumns,
  reportShareUrl,
  toReportShare,
  type ReportShareRow,
} from "@/lib/server/report-shares"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/** Most recent first; older links stay in the audit log. */
const LIST_LIMIT = 50

/**
 * A client's report share links: read-only links an owner or admin sends
 * the client (see lib/server/report-shares.ts). The token is returned once,
 * in the POST response's `url`; only its hash is stored, so a lost link is
 * revoked and made again rather than recovered.
 */
export const GET = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  handler: async ({ session, params, tenant }) => {
    const items = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      const rows = await sql<ReportShareRow[]>`
        select ${reportShareColumns(sql)}
        from report_share s
        left join app_user u on u.id = s.created_by
        where s.client_id = ${params.clientId}
        order by s.created_at desc
        limit ${LIST_LIMIT}
      `
      const now = new Date()
      return rows.map((row) => toReportShare(row, now))
    })
    return { items } satisfies ReportSharesResponse
  },
})

export const POST = route({
  roles: ["owner", "admin"],
  params: clientIdParamsSchema,
  body: reportShareCreateSchema,
  handler: async ({
    request,
    session,
    params,
    body,
    requestId,
    clientRequestId,
    tenant,
  }) => {
    const { token, tokenHash } = createReportShareToken()
    const share = await tenant(async (sql) => {
      await requireClientAccess(sql, session, params.clientId)
      // An archived client's links never resolve (lookup_report_share), so
      // making one would hand out a link that is dead on arrival.
      const [client] = await sql<{ archived: boolean }[]>`
        select archived_at is not null as archived
        from client
        where id = ${params.clientId}
      `
      if (client?.archived) {
        throw new ApiError(
          409,
          "client_archived",
          "This client is archived. Restore it before sharing its report."
        )
      }
      const [row] = await sql<ReportShareRow[]>`
        with inserted as (
          insert into report_share (
            organisation_id,
            client_id,
            token_hash,
            created_by,
            expires_at
          )
          values (
            ${session.organisationId},
            ${params.clientId},
            ${tokenHash},
            ${session.userId},
            now() + make_interval(days => ${body.expiresInDays})
          )
          returning *
        )
        select ${reportShareColumns(sql)}
        from inserted s
        left join app_user u on u.id = s.created_by
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "report_share.created",
        subjectType: "report_share",
        subjectId: row.id,
        requestId,
        metadata: {
          clientId: params.clientId,
          expiresInDays: body.expiresInDays,
          expiresAt: row.expiresAt.toISOString(),
          clientRequestId,
        },
      })
      return toReportShare(row)
    })
    const baseUrl = getServerEnv().NEXTAUTH_URL ?? new URL(request.url).origin
    return NextResponse.json(
      {
        share,
        url: reportShareUrl(token, baseUrl),
      } satisfies ReportShareCreatedResponse,
      { status: 201, headers: { "Cache-Control": "no-store" } }
    )
  },
})
