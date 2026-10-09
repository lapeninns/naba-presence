import {
  aiCreditsOrganisationParamsSchema,
  aiCreditsOverrideInputSchema,
} from "@/lib/contracts/ai-credits"
import { getAiCredits } from "@/lib/server/ai-credits"
import { writeAudit } from "@/lib/server/audit"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Operator endpoint (cron-bearer, like /api/operations/reencrypt): sets or
 * clears one organisation's monthly AI draft credit override. Support-only;
 * there is no customer-facing way to raise the allowance.
 */
export const PUT = route({
  auth: "cron",
  params: aiCreditsOrganisationParamsSchema,
  body: aiCreditsOverrideInputSchema,
  handler: ({ params, body, requestId }) =>
    withTenant(params.id, async (sql) => {
      const [updated] = await sql<{ id: string }[]>`
        update organisation
        set ai_monthly_draft_credits = ${body.monthlyDraftCredits}
        where id = ${params.id}
        returning id::text as id
      `
      if (!updated) {
        throw new ApiError(404, "organisation_not_found", "Not found.")
      }
      await writeAudit(sql, {
        organisationId: params.id,
        action: "ai_credits.override_set",
        subjectType: "organisation",
        subjectId: params.id,
        requestId,
        metadata: { monthlyDraftCredits: body.monthlyDraftCredits },
      })
      return getAiCredits(sql, params.id)
    }),
})
