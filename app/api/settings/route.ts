import { settingsPatchSchema } from "@/lib/contracts/settings"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

export const GET = route({
  handler: async ({ session, tenant }) => {
    const settings = await tenant(async (sql) => {
      const [row] = await sql`
        select
          approval_required as "approvalRequired",
          require_two_person_approval as "requireTwoPersonApproval",
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
    return { settings }
  },
})

export const PATCH = route({
  roles: ["owner", "admin"],
  body: settingsPatchSchema,
  handler: async ({
    session,
    body: input,
    requestId,
    clientRequestId,
    tenant,
  }) => {
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
    const settings = await tenant(async (sql) => {
      const [row] = await sql`
        update organisation
        set
          approval_required = ${input.approvalRequired},
          require_two_person_approval = coalesce(
            ${input.requireTwoPersonApproval ?? null},
            require_two_person_approval
          ),
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
          require_two_person_approval as "requireTwoPersonApproval",
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
        requestId,
        metadata: { ...input, clientRequestId },
      })
      return row
    })
    return { settings }
  },
})
