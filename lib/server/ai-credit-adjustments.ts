import "server-only"

import type { TransactionSql } from "postgres"

import type {
  AiCreditAdjustment,
  AiCreditAdjustmentInput,
  CreditPeriodKind,
} from "@/lib/contracts/ai-credits"
import { readCreditLedger } from "@/lib/server/ai-credits"
import { writeAudit } from "@/lib/server/audit"
import { ApiError } from "@/lib/server/http"

/**
 * Operator AI credit adjustments (plan P07-S7, migration 0228). A grant is an
 * append-only `ai_credit_period` row of kind 'adjustment' that names the
 * organisation's current base period (pilot month, trial or paid period);
 * the ledger adds its credits to that period's allowance. It never touches
 * usage, so the credits already used stay used, and it ends with its
 * period. Every grant records the operator and the reason, in the row and in
 * the audit log.
 */

/** How many grants the operator history returns, newest first. */
export const ADJUSTMENT_HISTORY_LIMIT = 100

type AdjustmentRow = {
  id: string
  periodId: string
  periodKind: CreditPeriodKind
  credits: number
  reason: string
  operator: string
  sourceRef: string
  createdAt: Date
  periodEnd: Date
}

const REFERENCE_PREFIX = "adjustment:"

function toAdjustment(
  row: AdjustmentRow,
  currentPeriodId: string | null
): AiCreditAdjustment {
  return {
    id: row.id,
    periodId: row.periodId,
    periodKind: row.periodKind,
    credits: row.credits,
    reason: row.reason,
    operator: row.operator,
    reference: row.sourceRef.slice(REFERENCE_PREFIX.length),
    createdAt: new Date(row.createdAt).toISOString(),
    periodEnd: new Date(row.periodEnd).toISOString(),
    current: row.periodId === currentPeriodId,
  }
}

const selectAdjustments = (
  sql: TransactionSql,
  organisationId: string,
  sourceRef: string | null
) => sql<AdjustmentRow[]>`
  select
    a.id::text as id,
    p.id::text as "periodId",
    p.kind as "periodKind",
    a.allowance as credits,
    a.reason,
    a.granted_by as operator,
    a.source_ref as "sourceRef",
    a.created_at as "createdAt",
    p.ends_at as "periodEnd"
  from ai_credit_period a
  join ai_credit_period p
    on p.organisation_id = a.organisation_id
   and p.id = a.applies_to_period_id
  where a.organisation_id = ${organisationId}
    and a.kind = 'adjustment'
    and (${sourceRef}::text is null or a.source_ref = ${sourceRef}::text)
  order by a.created_at desc, a.id desc
  limit ${ADJUSTMENT_HISTORY_LIMIT}
`

/** The organisation's grants, newest first (at most ADJUSTMENT_HISTORY_LIMIT). */
export async function listCreditAdjustments(
  sql: TransactionSql,
  organisationId: string,
  currentPeriodId: string | null
): Promise<AiCreditAdjustment[]> {
  const rows = await selectAdjustments(sql, organisationId, null)
  return rows.map((row) => toAdjustment(row, currentPeriodId))
}

/**
 * Grants `input.credits` extra draft credits for the organisation's current
 * credit period. Under the organisation row lock (readCreditLedger), so it
 * serialises with reservations and with a concurrent grant of the same
 * reference. The reference is the idempotency key: a repeat with the same
 * credits, reason and operator returns the recorded grant (`replayed`), and
 * a different one is refused with 409 `ai_credit_adjustment_conflict`.
 *
 * Fails closed with 409 when there is nothing safe to add to: no current
 * period (`ai_credit_period_missing`, e.g. a trial or paid period billing
 * has not granted yet) or a period whose allowance is unknown
 * (`ai_allowance_unknown`).
 */
export async function grantCreditAdjustment(
  sql: TransactionSql,
  organisationId: string,
  input: AiCreditAdjustmentInput,
  context: { requestId: string | null }
): Promise<{ adjustment: AiCreditAdjustment; replayed: boolean }> {
  const ledger = await readCreditLedger(sql, organisationId, { lock: true })
  const sourceRef = `${REFERENCE_PREFIX}${input.reference}`
  const currentPeriodId = ledger.period?.id ?? null

  const [existing] = await selectAdjustments(sql, organisationId, sourceRef)
  if (existing) {
    if (
      existing.credits !== input.credits ||
      existing.reason !== input.reason ||
      existing.operator !== input.operator
    ) {
      throw new ApiError(
        409,
        "ai_credit_adjustment_conflict",
        "That reference already names a different adjustment.",
        { details: { adjustmentId: existing.id } }
      )
    }
    return {
      adjustment: toAdjustment(existing, currentPeriodId),
      replayed: true,
    }
  }

  const period = ledger.period
  if (!period) {
    throw new ApiError(
      409,
      "ai_credit_period_missing",
      "The organisation has no current credit period to add credits to."
    )
  }
  if (ledger.allowance === null) {
    throw new ApiError(
      409,
      "ai_allowance_unknown",
      "The current credit period's allowance is unknown, so nothing can be added to it."
    )
  }

  const [inserted] = await sql<{ id: string }[]>`
    insert into ai_credit_period (
      organisation_id, kind, starts_at, ends_at, allowance, source_ref,
      applies_to_period_id, reason, granted_by
    )
    values (
      ${organisationId}, 'adjustment', ${period.startsAt}, ${period.endsAt},
      ${input.credits}, ${sourceRef}, ${period.id}, ${input.reason},
      ${input.operator}
    )
    returning id::text as id
  `
  await writeAudit(sql, {
    organisationId,
    action: "ai_credits.adjustment_granted",
    subjectType: "ai_credit_period",
    subjectId: inserted.id,
    requestId: context.requestId,
    metadata: {
      periodId: period.id,
      periodKind: period.kind,
      credits: input.credits,
      allowanceBefore: ledger.allowance,
      usedBefore: ledger.used,
      reason: input.reason,
      operator: input.operator,
      reference: input.reference,
    },
  })
  const [row] = await selectAdjustments(sql, organisationId, sourceRef)
  return { adjustment: toAdjustment(row, period.id), replayed: false }
}
