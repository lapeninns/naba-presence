import type { TransactionSql } from "postgres"

import {
  aiCreditAdjustmentInputSchema,
  aiCreditsOrganisationParamsSchema,
  aiCreditsOverrideInputSchema,
  type AiCreditAdjustmentResult,
  type AiCreditsOperatorView,
} from "@/lib/contracts/ai-credits"
import {
  grantCreditAdjustment,
  listCreditAdjustments,
} from "@/lib/server/ai-credit-adjustments"
import { getAiCredits } from "@/lib/server/ai-credits"
import { writeAudit } from "@/lib/server/audit"
import { getOrganisationBilling } from "@/lib/server/billing/state"
import { withTenant } from "@/lib/server/db"
import { ApiError } from "@/lib/server/http"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"

/**
 * Operator endpoints (cron-bearer, like /api/operations/reencrypt) for one
 * organisation's AI draft credits. Support-only; there is no
 * customer-facing way to raise the allowance (docs/runbook.md, "Manual AI
 * credit grants").
 *
 * - GET: the current balance and the grant history.
 * - POST: an audited adjustment that adds credits to the current credit
 *   period, with the operator and reason recorded (plan P07-S7).
 * - PUT: a pilot's calendar-month allowance override, kept for pilots only.
 *
 * The shared cron bearer carries no operator identity, so the body names the
 * operator (D-33).
 */

async function operatorView(
  sql: TransactionSql,
  organisationId: string
): Promise<AiCreditsOperatorView> {
  const credits = await getAiCredits(sql, organisationId)
  return {
    credits,
    adjustments: await listCreditAdjustments(
      sql,
      organisationId,
      credits.periodId
    ),
  }
}

export const GET = route({
  auth: "cron",
  params: aiCreditsOrganisationParamsSchema,
  handler: ({ params }) =>
    withTenant(params.id, (sql) => operatorView(sql, params.id)),
})

export const POST = route({
  auth: "cron",
  params: aiCreditsOrganisationParamsSchema,
  body: aiCreditAdjustmentInputSchema,
  handler: ({ params, body, requestId }) =>
    withTenant(params.id, async (sql): Promise<AiCreditAdjustmentResult> => {
      const { adjustment, replayed } = await grantCreditAdjustment(
        sql,
        params.id,
        body,
        { requestId }
      )
      return { ...(await operatorView(sql, params.id)), adjustment, replayed }
    }),
})

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
      // Only a pilot month reads the override. Setting one for any other
      // organisation would look applied and change nothing (the throw rolls
      // the update back); clearing a stale one is always allowed.
      if (body.monthlyDraftCredits !== null) {
        const view = await getOrganisationBilling(sql, params.id)
        const state = view.billing?.state ?? null
        if (state !== "pilot") {
          throw new ApiError(
            409,
            "ai_credits_override_pilot_only",
            "The monthly override applies to pilots only. Grant an adjustment instead.",
            { details: { state } }
          )
        }
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
