import "server-only"

import type { TransactionSql } from "postgres"

import type { AiUsage } from "@/lib/server/ai"
import {
  backstopWouldBeExceeded,
  readCreditLedger,
  releaseReservation,
  settleReservation,
  type Tenant,
} from "@/lib/server/ai-credits"

/**
 * Verification calls in the AI ledger. A verification never costs a draft
 * credit, but it is a provider call: it reserves its token budget under the
 * organisation lock before the call (so verify and draft calls running in
 * parallel cannot together pass the backstop) and records its real usage
 * against the same credit period afterwards.
 */

export type VerifyReservation = { id: string; periodId: string | null }

/**
 * Reserves one verification call (status `reserved`, credits 0) in the
 * current credit period, or returns null when the call could take the
 * period past the token backstop; the caller then skips the semantic pass
 * and the draft stays unverified. Runs in the caller's tenant transaction.
 *
 * `requestKey` names the call; the unique (organisation, kind, request_id)
 * key means a key already in the ledger reserves nothing (null).
 */
export async function reserveVerifyUsage(
  sql: TransactionSql,
  input: {
    organisationId: string
    model: string
    reviewId: string | null
    draftId: string | null
    requestKey: string
    userId: string | null
  }
): Promise<VerifyReservation | null> {
  const ledger = await readCreditLedger(sql, input.organisationId, {
    lock: true,
  })
  if (backstopWouldBeExceeded(ledger)) return null
  const periodId = ledger.period?.id ?? null
  const [row] = await sql<{ id: string }[]>`
    insert into ai_usage (
      organisation_id, kind, status, credits, model,
      review_id, draft_id, request_id, user_id, period_start, credit_period_id
    )
    values (
      ${input.organisationId}, 'verify', 'reserved', 0, ${input.model},
      ${input.reviewId}, ${input.draftId}, ${input.requestKey}, ${input.userId},
      (date_trunc('month', now() at time zone 'utc'))::date,
      ${periodId}
    )
    on conflict (organisation_id, kind, request_id) where request_id is not null
    do nothing
    returning id::text as id
  `
  return row ? { id: row.id, periodId } : null
}

/**
 * Settles a verification reservation with what the provider reported, or
 * releases it when no usage came back. Never throws.
 */
export async function finishVerifyUsage(
  tenant: Tenant,
  input: { id: string; usage?: AiUsage; model?: string }
): Promise<void> {
  if (input.usage && input.model) {
    await settleReservation(
      tenant,
      { id: input.id, usage: input.usage, model: input.model },
      "ai_usage_record_failed"
    )
    return
  }
  await releaseReservation(tenant, { id: input.id }, "ai_usage_record_failed")
}
