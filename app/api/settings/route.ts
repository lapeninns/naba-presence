import { NextResponse } from "next/server"
import { z } from "zod"

import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError, apiError, serverRequestId } from "@/lib/server/http"
import { requireRole, requireSession } from "@/lib/server/session"

export const runtime = "nodejs"

const settingsSchema = z.object({
  approvalRequired: z.boolean(),
  rawContentRetentionDays: z.number().int().min(1).max(30),
  defaultLanguageCode: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(?:-[A-Z]{2})?$/),
  defaultTimezone: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value })
        return true
      } catch {
        return false
      }
    }, "Use a valid IANA timezone."),
  directPublishConsent: z.boolean().default(false),
})

export async function GET() {
  try {
    const session = await requireSession()
    const settings = await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql`
        select
          approval_required as "approvalRequired",
          raw_content_retention_days as "rawContentRetentionDays",
          default_language_code as "defaultLanguageCode",
          default_timezone as "defaultTimezone",
          direct_publish_consent_at as "directPublishConsentAt"
        from organisation
        where id = ${session.organisationId}
      `
      if (!row) {
        throw new ApiError(
          404,
          "organisation_not_found",
          "Organisation not found."
        )
      }
      return row
    })
    return NextResponse.json({ settings })
  } catch (error) {
    return apiError(error)
  }
}

export async function PATCH(request: Request) {
  try {
    const rid = serverRequestId(request)
    const session = requireRole(await requireSession(), ["owner", "admin"])
    const input = settingsSchema.parse(await request.json())
    if (
      !input.approvalRequired &&
      (session.role !== "owner" || !input.directPublishConsent)
    ) {
      throw new ApiError(
        403,
        "direct_publish_consent_required",
        "An owner must explicitly consent before direct publishing is enabled."
      )
    }
    const settings = await withTenant(session.organisationId, async (sql) => {
      const [row] = await sql`
        update organisation
        set
          approval_required = ${input.approvalRequired},
          raw_content_retention_days = ${input.rawContentRetentionDays},
          default_language_code = ${input.defaultLanguageCode},
          default_timezone = ${input.defaultTimezone},
          direct_publish_consent_at = case
            when ${input.approvalRequired} then null
            when ${input.directPublishConsent}
              then coalesce(direct_publish_consent_at, now())
            else direct_publish_consent_at
          end,
          direct_publish_consent_by = case
            when ${input.approvalRequired} then null
            when ${input.directPublishConsent} then ${session.userId}
            else direct_publish_consent_by
          end
        where id = ${session.organisationId}
        returning
          approval_required as "approvalRequired",
          raw_content_retention_days as "rawContentRetentionDays",
          default_language_code as "defaultLanguageCode",
          default_timezone as "defaultTimezone",
          direct_publish_consent_at as "directPublishConsentAt"
      `
      await writeAudit(sql, {
        organisationId: session.organisationId,
        actorUserId: session.userId,
        action: "organisation.settings.updated",
        subjectType: "organisation",
        subjectId: session.organisationId,
        requestId: rid.id,
        metadata: { ...input, clientRequestId: rid.clientId },
      })
      return row
    })
    return NextResponse.json({ settings })
  } catch (error) {
    return apiError(error)
  }
}
