import "server-only"

import type { TransactionSql } from "postgres"

import type { AiUsage } from "@/lib/server/ai"
import { log } from "@/lib/server/logger"

export type AiUsageKind = "draft" | "verify"

/**
 * Insert one settled `ai_usage` row for a provider call that completed.
 * Runs inside the caller's tenant transaction, so RLS scopes it. Records cost
 * only: it never limits or refuses anything.
 */
export async function recordAiUsage(
  sql: TransactionSql,
  input: {
    organisationId: string
    kind: AiUsageKind
    credits: number
    model: string
    usage: AiUsage
    reviewId?: string | null
    draftId?: string | null
    requestId?: string | null
    userId?: string | null
  }
): Promise<void> {
  await sql`
    insert into ai_usage (
      organisation_id, kind, status, credits, model,
      input_tokens, output_tokens, review_id, draft_id, request_id,
      user_id, period_start, settled_at
    )
    values (
      ${input.organisationId},
      ${input.kind},
      'settled',
      ${input.credits},
      ${input.model},
      ${input.usage.inputTokens},
      ${input.usage.outputTokens},
      ${input.reviewId ?? null},
      ${input.draftId ?? null},
      ${input.requestId ?? null},
      ${input.userId ?? null},
      (date_trunc('month', now() at time zone 'utc'))::date,
      now()
    )
    on conflict (organisation_id, kind, request_id) where request_id is not null
    do nothing
  `
}

type UsageInput = Parameters<typeof recordAiUsage>[1]

/**
 * Record usage in its own transaction, apart from the user-facing work, so a
 * later failure there cannot roll the row back and a ledger failure (missing
 * table, grant) cannot fail the request. Never throws.
 */
export async function recordAiUsageDetached(
  tenant: <T>(fn: (sql: TransactionSql) => Promise<T>) => Promise<T>,
  inputs: UsageInput[]
): Promise<void> {
  if (inputs.length === 0) return
  try {
    await tenant(async (sql) => {
      for (const input of inputs) await recordAiUsage(sql, input)
    })
  } catch (error) {
    log.error("ai_usage_record_failed", {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
