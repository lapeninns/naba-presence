import "server-only"

import type { Sql, TransactionSql } from "postgres"

import {
  fillDailyCredits,
  type AiCredits,
  type AiCreditsDaily,
  type CreditPeriodKind,
} from "@/lib/contracts/ai-credits"
import type { Access, BillingState } from "@/lib/domain/entitlements"
import type { AiUsage } from "@/lib/server/ai"
import {
  accessFromView,
  getOrganisationBilling,
} from "@/lib/server/billing/state"
import { getServerEnv } from "@/lib/server/env"
import { ApiError } from "@/lib/server/http"
import { log } from "@/lib/server/logger"

/**
 * The AI reservation ledger (`ai_usage`) against explicit credit periods
 * (`ai_credit_period`, plan P07-S2). Every provider call is reserved before
 * it is made, settled with its real token counts when it returns and
 * released when it fails:
 *
 * - a draft generation reserves one credit, refused when billing is
 *   read-only, the allowance is unknown or spent, or the token backstop
 *   would be passed. Its generation key is stable across retries, so a
 *   retried request finds its first reservation instead of paying again;
 * - a verification (lib/server/ai-usage.ts) reserves no credit, only its
 *   token budget, so the backstop also holds against verify calls running
 *   in parallel with drafts.
 *
 * A reservation names its period and keeps it: a settle after the period
 * rolled over still lands in the period that paid for the call. Every
 * instant comes from the database clock.
 */

/** Reservations older than this are released by the job tick. */
export const STALE_RESERVATION_MINUTES = 10

export type Tenant = <T>(fn: (sql: TransactionSql) => Promise<T>) => Promise<T>

/**
 * What one provider call holds against the token backstop until its real
 * counts are written: the output cap every call is sent with
 * (AI_MAX_OUTPUT_TOKENS) plus a prompt estimate. A prompt is the review (at
 * most 4,096 characters from Google), the business context and the fixed
 * instructions, well inside this estimate. Settling replaces it with the
 * provider's own counts.
 */
export const CALL_INPUT_TOKEN_ESTIMATE = 8_192

export function callTokenBudget(): number {
  return getServerEnv().AI_MAX_OUTPUT_TOKENS + CALL_INPUT_TOKEN_ESTIMATE
}

/** One allowance grant (`ai_credit_period`, migration 0220). */
export type CreditPeriod = {
  id: string
  kind: CreditPeriodKind
  startsAt: Date
  endsAt: Date
  /** The row's allowance; null = unknown. */
  allowance: number | null
}

/**
 * The period kind that funds AI work in each billing state. A pilot is
 * funded by its calendar month, a trial by the trial grant and every paid
 * state by its paid-period grant; the billing processor (P07-S4) creates the
 * latter two. Adjustments (P07-S7) are never the current period: each adds
 * to the base period it names (readCreditLedger).
 */
function periodKindFor(state: BillingState | null): CreditPeriodKind | null {
  if (state === null) return null
  if (state === "pilot") return "pilot_month"
  if (state === "trialing") return "trial"
  return "paid_period"
}

async function findPeriod(
  sql: TransactionSql,
  organisationId: string,
  kind: CreditPeriodKind
): Promise<CreditPeriod | undefined> {
  const [row] = await sql<CreditPeriod[]>`
    select
      id::text as id,
      kind,
      starts_at as "startsAt",
      ends_at as "endsAt",
      allowance
    from ai_credit_period
    where organisation_id = ${organisationId}
      and kind = ${kind}
      and starts_at <= now()
      and ends_at > now()
    order by starts_at desc, created_at desc
    limit 1
  `
  return row
}

/**
 * The organisation's current credit period, by the database clock. A pilot's
 * calendar month (UTC) is created the first time it is needed: the insert is
 * idempotent on (organisation, kind, 'pilot:YYYY-MM'), so concurrent first
 * requests of a month leave exactly one row. Trial and paid periods are only
 * ever created by billing; without one the period is null and the allowance
 * unknown.
 */
export async function currentCreditPeriod(
  sql: TransactionSql,
  organisationId: string,
  state: BillingState | null,
  pilotAllowance: number
): Promise<CreditPeriod | null> {
  const kind = periodKindFor(state)
  if (!kind) return null
  let row = await findPeriod(sql, organisationId, kind)
  if (!row && kind === "pilot_month") {
    await sql`
      insert into ai_credit_period (
        organisation_id, kind, starts_at, ends_at, allowance, source_ref
      )
      select
        ${organisationId},
        'pilot_month',
        month at time zone 'utc',
        (month + interval '1 month') at time zone 'utc',
        ${pilotAllowance},
        'pilot:' || to_char(month, 'YYYY-MM')
      from (select date_trunc('month', now() at time zone 'utc') as month) m
      on conflict (organisation_id, kind, source_ref) do nothing
    `
    row = await findPeriod(sql, organisationId, kind)
  }
  return row ?? null
}

export type CreditLedger = {
  /** The database clock at the start of this transaction. */
  now: Date
  access: Access
  period: CreditPeriod | null
  /**
   * The effective allowance: the period's own plus its adjustments; null =
   * unknown, which blocks AI drafting.
   */
  allowance: number | null
  /** Credits operator adjustments add to this period (0 with none). */
  adjusted: number
  /** Draft credits reserved or settled in the period. */
  used: number
  /**
   * Tokens recorded in the period, plus `callTokenBudget()` for every call
   * still in flight (reserved, no counts yet).
   */
  tokens: number
}

/** The credits every adjustment of one base period adds to it. */
async function adjustedCredits(
  sql: TransactionSql,
  organisationId: string,
  periodId: string
): Promise<number> {
  const [row] = await sql<{ credits: number }[]>`
    select coalesce(sum(allowance), 0)::integer as credits
    from ai_credit_period
    where organisation_id = ${organisationId}
      and kind = 'adjustment'
      and applies_to_period_id = ${periodId}
  `
  return row.credits
}

type OrganisationClock = { override: number | null; now: Date; month: string }

/**
 * Reads the organisation's AI ledger for its current period. With `lock` it
 * first takes the organisation row lock, which serialises every reservation
 * (draft or verify) and settle for one organisation, so the allowance and
 * backstop checks that follow cannot interleave with another's insert.
 *
 * Usage is counted by credit_period_id. Rows written before periods existed
 * have none; they belong to the pilot month whose UTC start they name
 * (period_start), and to no trial or paid period.
 */
export async function readCreditLedger(
  sql: TransactionSql,
  organisationId: string,
  options: { lock: boolean }
): Promise<CreditLedger> {
  const [org] = options.lock
    ? await sql<OrganisationClock[]>`
        select
          ai_monthly_draft_credits as override,
          now() as now,
          (date_trunc('month', now() at time zone 'utc'))::date::text as month
        from organisation
        where id = ${organisationId}
        for update
      `
    : await sql<OrganisationClock[]>`
        select
          ai_monthly_draft_credits as override,
          now() as now,
          (date_trunc('month', now() at time zone 'utc'))::date::text as month
        from organisation
        where id = ${organisationId}
      `
  if (!org) throw new ApiError(404, "organisation_not_found", "Not found.")
  const view = await getOrganisationBilling(sql, organisationId)
  const access = accessFromView(view, new Date(org.now))
  // The pilot allowance is read live, so an operator override applies to the
  // current month at once; the period row records the value it began with.
  const pilotAllowance = org.override ?? getServerEnv().AI_MONTHLY_DRAFT_CREDITS
  const period = await currentCreditPeriod(
    sql,
    organisationId,
    view.billing?.state ?? null,
    pilotAllowance
  )
  const baseAllowance = !period
    ? null
    : period.kind === "pilot_month"
      ? pilotAllowance
      : period.allowance
  // Operator adjustments add to the period they name (P07-S7). An unknown
  // base allowance stays unknown: a grant cannot make it known.
  const adjusted = period
    ? await adjustedCredits(sql, organisationId, period.id)
    : 0
  const allowance = baseAllowance === null ? null : baseAllowance + adjusted
  // Rows with no period id: legacy rows count toward the pilot month they
  // name; with no period at all, this UTC month's unlinked verification rows
  // still count toward the backstop.
  const legacyMonth = !period
    ? org.month
    : period.kind === "pilot_month"
      ? new Date(period.startsAt).toISOString().slice(0, 10)
      : null
  const [row] = await sql<{ used: number; tokens: string; inFlight: number }[]>`
    select
      coalesce(sum(credits) filter (
        where kind = 'draft' and status in ('reserved', 'settled')
      ), 0)::integer as used,
      coalesce(
        sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)), 0
      )::text as tokens,
      (count(*) filter (
        where status = 'reserved'
          and input_tokens is null
          and output_tokens is null
      ))::integer as "inFlight"
    from ai_usage
    where organisation_id = ${organisationId}
      and (
        credit_period_id = ${period?.id ?? null}::uuid
        or (
          credit_period_id is null
          and period_start = ${legacyMonth}::date
        )
      )
  `
  return {
    now: new Date(org.now),
    access,
    period,
    allowance,
    adjusted,
    used: row.used,
    tokens: Number(row.tokens) + row.inFlight * callTokenBudget(),
  }
}

export async function getAiCredits(
  sql: TransactionSql,
  organisationId: string
): Promise<AiCredits> {
  const ledger = await readCreditLedger(sql, organisationId, { lock: false })
  const { period, allowance } = ledger
  return {
    used: ledger.used,
    allowance,
    remaining: allowance === null ? null : Math.max(0, allowance - ledger.used),
    periodId: period?.id ?? null,
    periodKind: period?.kind ?? null,
    periodStart: period ? new Date(period.startsAt).toISOString() : null,
    periodEnd: period ? new Date(period.endsAt).toISOString() : null,
    canUseAi: ledger.access.canUseAi,
    accessReason: ledger.access.reason,
  }
}

/** True when one more provider call could take the period past the backstop. */
export function backstopWouldBeExceeded(ledger: CreditLedger): boolean {
  return (
    ledger.tokens + callTokenBudget() > getServerEnv().AI_MONTHLY_TOKEN_BACKSTOP
  )
}

/** A draft generation's ledger row, found by its generation key. */
export type ExistingGeneration = {
  id: string
  status: "reserved" | "settled" | "released"
  reviewId: string | null
  draftId: string | null
}

export type DraftReservation =
  | { kind: "reserved"; id: string; periodId: string }
  | { kind: "existing"; generation: ExistingGeneration }

/**
 * Phase one. Under the organisation row lock: a generation key already in
 * the ledger is returned as it stands (a retried request must not reserve,
 * or pay, twice); otherwise the period is checked and a `reserved` row
 * (credits = 1) stamped with the period id is inserted, or the request is
 * refused. Must run in the caller's tenant transaction, which commits before
 * the provider call.
 *
 * `generationKey` is the stable generation id: `intent:<Idempotency-Key>`
 * when the client sent one (lib/server/mutation-operations.ts
 * requestScopedKeyPart), else the server request id.
 */
export async function reserveDraftCredit(
  sql: TransactionSql,
  input: {
    organisationId: string
    model: string
    reviewId: string
    draftId: string
    generationKey: string
    userId: string | null
  }
): Promise<DraftReservation> {
  const ledger = await readCreditLedger(sql, input.organisationId, {
    lock: true,
  })
  const [existing] = await sql<ExistingGeneration[]>`
    select
      id::text as id,
      status,
      review_id::text as "reviewId",
      draft_id::text as "draftId"
    from ai_usage
    where organisation_id = ${input.organisationId}
      and kind = 'draft'
      and request_id = ${input.generationKey}
  `
  if (existing) return { kind: "existing", generation: existing }
  if (!ledger.access.canUseAi) {
    throw new ApiError(
      402,
      "billing_read_only",
      "AI drafting is unavailable while this workspace's subscription is read-only. You can still write a reply yourself.",
      { details: { reason: ledger.access.reason } }
    )
  }
  if (!ledger.period || ledger.allowance === null) {
    throw new ApiError(
      402,
      "ai_allowance_unknown",
      "Your AI credit allowance is not confirmed yet, so AI drafting is off for now. You can still write a reply yourself."
    )
  }
  if (backstopWouldBeExceeded(ledger)) {
    throw new ApiError(
      429,
      "ai_token_backstop",
      "AI drafting is paused for this period because of unusually high usage. You can still write a reply yourself."
    )
  }
  if (ledger.used >= ledger.allowance) {
    throw new ApiError(
      402,
      "ai_credits_exhausted",
      "You are out of AI credits for this period. You can still write a reply yourself.",
      {
        details: {
          used: ledger.used,
          allowance: ledger.allowance,
          resetsAt: new Date(ledger.period.endsAt).toISOString(),
        },
      }
    )
  }
  const [row] = await sql<{ id: string }[]>`
    insert into ai_usage (
      organisation_id, kind, status, credits, model,
      review_id, draft_id, request_id, user_id, period_start, credit_period_id
    )
    values (
      ${input.organisationId}, 'draft', 'reserved', 1, ${input.model},
      ${input.reviewId}, ${input.draftId}, ${input.generationKey},
      ${input.userId},
      (date_trunc('month', now() at time zone 'utc'))::date,
      ${ledger.period.id}
    )
    returning id::text as id
  `
  return { kind: "reserved", id: row.id, periodId: ledger.period.id }
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
 * The provider call completed: write its real token counts. A draft row's
 * credit is spent (credits = 1); a verification row never costs one. Also
 * applies to a row the reaper already released, because the money was spent;
 * the allowance is deliberately not re-checked then (the provider call is
 * already paid for, and the ledger must say so). Overrun is bounded because
 * WORKERS_AI_TIMEOUT_MS (max 55s) is far below STALE_RESERVATION_MINUTES.
 * The row keeps the credit period it was reserved in. The organisation row
 * is locked, as in reserveDraftCredit, so a settle never interleaves with
 * another reservation's check-and-insert. Never throws.
 */
export async function settleReservation(
  tenant: Tenant,
  input: { id: string; usage: AiUsage; model: string; draftId?: string },
  event = "ai_credit_settle_failed"
): Promise<void> {
  await writeLedger(
    tenant,
    event,
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
        set status = 'settled',
            credits = case when kind = 'draft' then 1 else 0 end,
            model = ${input.model},
            input_tokens = ${input.usage.inputTokens},
            output_tokens = ${input.usage.outputTokens},
            draft_id = coalesce(${input.draftId ?? null}::uuid, draft_id),
            settled_at = now()
        where id = ${input.id} and status in ('reserved', 'released')
      `
    }
  )
}

/** Phase three of a draft generation: see settleReservation. */
export function settleDraftCredit(
  tenant: Tenant,
  input: { id: string; usage: AiUsage; model: string; draftId: string }
): Promise<void> {
  return settleReservation(tenant, input)
}

/**
 * The provider call failed: the customer does not pay. Tokens of a billed but
 * unreadable response are kept so the backstop still sees them, including on
 * a row the reaper already released (its credits stay 0). Never throws.
 */
export async function releaseReservation(
  tenant: Tenant,
  input: { id: string; usage?: AiUsage },
  event = "ai_credit_release_failed"
): Promise<void> {
  await writeLedger(
    tenant,
    event,
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

/** A failed draft generation gives its credit back: see releaseReservation. */
export function releaseDraftCredit(
  tenant: Tenant,
  input: { id: string; usage?: AiUsage }
): Promise<void> {
  return releaseReservation(tenant, input)
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

/** Draft credits spent per UTC day of the current period, for the chart. */
export async function getAiCreditsDaily(
  sql: TransactionSql,
  organisationId: string
): Promise<AiCreditsDaily> {
  const ledger = await readCreditLedger(sql, organisationId, { lock: false })
  const { period } = ledger
  if (!period) return { days: [] }
  const legacyMonth =
    period.kind === "pilot_month"
      ? new Date(period.startsAt).toISOString().slice(0, 10)
      : null
  const rows = await sql<{ date: string; credits: number }[]>`
    select
      to_char(created_at at time zone 'utc', 'YYYY-MM-DD') as date,
      sum(credits)::integer as credits
    from ai_usage
    where organisation_id = ${organisationId}
      and (
        credit_period_id = ${period.id}::uuid
        or (credit_period_id is null and period_start = ${legacyMonth}::date)
      )
      and kind = 'draft'
      and status in ('reserved', 'settled')
    group by 1
  `
  const lastDay = new Date(
    Math.min(ledger.now.getTime(), new Date(period.endsAt).getTime() - 1)
  )
  return {
    days: fillDailyCredits(
      new Date(period.startsAt).toISOString().slice(0, 10),
      lastDay.toISOString().slice(0, 10),
      rows
    ),
  }
}
