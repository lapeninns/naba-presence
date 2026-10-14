import { billingReconcileSchema } from "@/lib/contracts/billing"
import {
  billingWorkGate,
  reconcileBillingPage,
  type ReconcilePageResult,
} from "@/lib/server/billing/process-events"
import { followCronCursor } from "@/lib/server/cron-cursor"
import { cronPageInput } from "@/lib/server/cron-query"
import { withAdvisoryLock } from "@/lib/server/leases"
import {
  loadPauseSnapshot,
  requireScopesEnabled,
} from "@/lib/server/pause-controls"
import { route } from "@/lib/server/route"

export const runtime = "nodejs"
export const maxDuration = 60

const BILLING_PAUSED = {
  code: "billing_paused",
  message: "Billing processing is paused.",
}

/**
 * No sync starts after the budget and one sync takes at most about 24s, so
 * 30s keeps the fire inside maxDuration (60s).
 */
const DEFAULT_BUDGET_MS = 30_000

function budgetMs() {
  const configured = Number(
    process.env.BILLING_RECONCILE_BUDGET_MS ?? DEFAULT_BUDGET_MS
  )
  return Number.isFinite(configured) && configured >= 0
    ? configured
    : DEFAULT_BUDGET_MS
}

/**
 * Hourly Stripe reconciliation (plan P07-S4), Vercel Cron. Walks every
 * organisation with a Stripe customer, as many pages as fit in the fire's
 * budget, resumed through cron_cursor ('billing'), and syncs each from
 * Stripe's current state. A webhook that never arrived is repaired by the
 * next full pass: within the hour while every linked organisation fits in
 * one fire, otherwise within ceil(organisations / per-fire) hours (see
 * docs/runbook.md). Independent of the
 * Google sync flags. The operator `billing` pause answers 503 (reported as
 * paused, not stale). While billing is disabled or unconfigured the tick
 * still completes, reconciling nothing, so its heartbeat keeps meaning the
 * cron is alive.
 */
export const GET = route({
  maxDuration,
  auth: "cron",
  handler: async ({ query, requestId }) => {
    const pauses = await loadPauseSnapshot()
    await requireScopesEnabled("billing", BILLING_PAUSED, { snapshot: pauses })
    const parsed = billingReconcileSchema.parse(cronPageInput(query))
    return followCronCursor("billing", parsed, async (input) => {
      const page = billingReconcileSchema.parse(input)
      const result = await withAdvisoryLock(
        "naba:billing-reconcile",
        async (): Promise<ReconcilePageResult> => {
          const gate = billingWorkGate(pauses)
          if (!gate.ok) {
            return {
              enabled: false,
              reason: gate.reason,
              processed: 0,
              nextCursor: null,
              failures: [],
            }
          }
          return reconcileBillingPage({
            input: page,
            requestId,
            budgetMs: budgetMs(),
            environment: gate.environment,
          })
        }
      )
      if ("skipped" in result) {
        return {
          enabled: true,
          processed: 0,
          nextCursor: null,
          failures: [],
          skipped: true,
        }
      }
      return { ...result, skipped: false }
    })
  },
})
