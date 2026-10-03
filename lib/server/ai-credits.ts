import "server-only"

import type { Sql, TransactionSql } from "postgres"

import type { AiCredits } from "@/lib/contracts/ai-credits"
import type { AiUsage } from "@/lib/server/ai"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/** Reservations older than this are released by the job tick. */
export const STALE_RESERVATION_MINUTES = 10

type Tenant = <T>(fn: (sql: TransactionSql) => Promise<T>) => Promise<T>

/** First day of the UTC month containing `now`, and the next period's start. */
export function billingPeriod(now: Date = new Date()): {
  periodStart: string
  resetsAt: Date
} {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
  )
  return { periodStart: start.toISOString().slice(0, 10), resetsAt: next }
}

async function readUsage(
  sql: TransactionSql,
  organisationId: string,
  lockOrganisation: boolean
): Promise<{ used: number; allowance: number; tokens: number }> {
  const [org] = lockOrganisation
    ? await sql<{ override: number | null }[]>`
        select ai_monthly_draft_credits as override
        from organisation
        where id = ${organisationId}
        for update
      `
    : await sql<{ override: number | null }[]>`
        select ai_monthly_draft_credits as override
        from organisation
        where id = ${organisationId}
      `
  if (!org) throw new ApiError(404, "organisation_not_found", "Not found.")
  // Reserved and settled draft rows carry credits = 1; released rows carry 0.
  const [row] = await sql<{ used: number; tokens: string }[]>`
    select
      coalesce(sum(credits) filter (
        where kind = 'draft' and status in ('reserved', 'settled')
      ), 0)::integer as used,
      coalesce(
        sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0
      )::text as tokens
    from ai_usage
    where organisation_id = ${organisationId}
      and period_start = (date_trunc('month', now() at time zone 'utc'))::date
  `
  return {
    used: row.used,
    tokens: Number(row.tokens),
    allowance: org.override ?? getServerEnv().AI_MONTHLY_DRAFT_CREDITS,
  }
}

export async function getAiCredits(
  sql: TransactionSql,
  organisationId: string,
  now: Date = new Date()
): Promise<AiCredits> {
  const { used, allowance } = await readUsage(sql, organisationId, false)
  const { periodStart, resetsAt } = billingPeriod(now)
  return {
    used,
    allowance,
    remaining: Math.max(0, allowance - used),
    periodStart,
    resetsAt: resetsAt.toISOString(),
  }
}

/** The runaway-loop guard: true once the month's tokens reach the backstop. */
export async function tokenBackstopReached(
  sql: TransactionSql,
  organisationId: string
): Promise<boolean> {
  const { tokens } = await readUsage(sql, organisationId, false)
  return tokens >= getServerEnv().AI_MONTHLY_TOKEN_BACKSTOP
}

/**
 * Phase one. Serialises reservations per organisation with a row lock, then
 * either inserts a `reserved` row (credits = 1) or throws the 402. Must run
 * in the caller's tenant transaction, which commits before the provider call.
 */
export async function reserveDraftCredit(
  sql: TransactionSql,
  input: {
    organisationId: string
    model: string
    reviewId: string
    draftId: string
    requestId: string
    userId: string | null
  }
): Promise<string> {
  const { used, allowance, tokens } = await readUsage(
    sql,
    input.organisationId,
    true
  )
  if (tokens >= getServerEnv().AI_MONTHLY_TOKEN_BACKSTOP) {
    throw new ApiError(
      429,
      "ai_token_backstop",
      "AI drafting is paused for this month because of unusually high usage. You can still write a reply yourself."
    )
  }
  if (used >= allowance) {
    throw new ApiError(
      402,
      "ai_credits_exhausted",
      "You are out of AI credits for this month. You can still write a reply yourself.",
      {
        details: {
          used,
          allowance,
          resetsAt: billingPeriod().resetsAt.toISOString(),
        },
      }
    )
  }
  const [row] = await sql<{ id: string }[]>`
    insert into ai_usage (
      organisation_id, kind, status, credits, model,
      review_id, draft_id, request_id, user_id, period_start
    )
    values (
      ${input.organisationId}, 'draft', 'reserved', 1, ${input.model},
      ${input.reviewId}, ${input.draftId}, ${input.requestId}, ${input.userId},
      (date_trunc('month', now() at time zone 'utc'))::date
    )
    returning id::text as id
  `
  return row.id
}

const LEDGER_WRITE_ATTEMPTS = 3

/**
 * Runs a ledger write in its own tenant transaction, retrying a transient
 * failure (a pooled connection blip) before giving up. Never throws: the
 * caller already has the provider result and must still deliver it. After the
 * final failure the ids and token counts are logged for reconciliation.
 */
async function writeLedger(
  tenant: Tenant,
  event: string,
  context: Record<string, unknown>,
  write: (sql: TransactionSql) => Promise<void>
): Promise<void> {
  let lastError: unknown
  for (let attempt = 1; attempt <= LEDGER_WRITE_ATTEMPTS; attempt += 1) {
    try {
      await tenant(write)
      return
    } catch (error) {
      lastError = error
      if (attempt < LEDGER_WRITE_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, 50 * attempt))
      }
    }
  }
  log.error(event, {
    ...context,
    error: lastError instanceof Error ? lastError.message : String(lastError),
  })
}

/**
 * Phase three: the provider call succeeded, so the credit is spent. Also
 * applies to a row the reaper already released, because the money was spent;
 * the allowance is deliberately not re-checked then (the provider call is
 * already paid for, and the ledger must say so). Overrun is bounded because
 * OPENAI_TIMEOUT_MS (max 55s) is far below STALE_RESERVATION_MINUTES. The
 * organisation row is locked, as in reserveDraftCredit, so a settle never
 * interleaves with another reservation's check-and-insert. Never throws.
 */
export async function settleDraftCredit(
  tenant: Tenant,
  input: { id: string; usage: AiUsage; model: string; draftId: string }
): Promise<void> {
  await writeLedger(
    tenant,
    "ai_credit_settle_failed",
    {
      reservationId: input.id,
      inputTokens: input.usage.inputTokens,
      outputTokens: input.usage.outputTokens,
    },
    async (sql) => {
      await sql`
        select o.id from organisation o
        where o.id = (select organisation_id from ai_usage where id = ${input.id})
        for update
      `
      await sql`
        update ai_usage
        set status = 'settled', credits = 1, model = ${input.model},
            input_tokens = ${input.usage.inputTokens},
            output_tokens = ${input.usage.outputTokens},
            draft_id = ${input.draftId}, settled_at = now()
        where id = ${input.id} and status in ('reserved', 'released')
      `
    }
  )
}

/**
 * The provider call failed: the customer does not pay. Tokens of a billed but
 * unreadable response are kept so the backstop still sees them, including on
 * a row the reaper already released (its credits stay 0). Never throws.
 */
export async function releaseDraftCredit(
  tenant: Tenant,
  input: { id: string; usage?: AiUsage }
): Promise<void> {
  await writeLedger(
    tenant,
    "ai_credit_release_failed",
    {
      reservationId: input.id,
      inputTokens: input.usage?.inputTokens ?? null,
      outputTokens: input.usage?.outputTokens ?? null,
    },
    async (sql) => {
      await sql`
        update ai_usage
        set status = 'released', credits = 0,
            input_tokens = coalesce(${input.usage?.inputTokens ?? null}, input_tokens),
            output_tokens = coalesce(${input.usage?.outputTokens ?? null}, output_tokens),
            settled_at = coalesce(settled_at, now())
        where id = ${input.id} and status in ('reserved', 'released')
      `
    }
  )
}

/**
 * Job-tick reaper: releases reservations whose process died before settling.
 * Their token cost is unknown and accepted; it is logged.
 */
export async function releaseStaleReservations(database: Sql): Promise<number> {
  const [row] = await database<{ released: number }[]>`
    select release_stale_ai_reservations(${STALE_RESERVATION_MINUTES}) as released
  `
  if (row.released > 0) {
    log.warn("ai_credits.stale_reservations_released", {
      released: row.released,
    })
  }
  return row.released
}
