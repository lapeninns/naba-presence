import { describe, expect, it } from "vitest"

import type { OrganisationBillingView } from "@/lib/server/billing/state"
import {
  BILLING_SYNC_FAILING_AFTER,
  billingFindings,
  type BillingHealthRow,
} from "@/lib/server/billing/alerts"
import { newMemberLimit } from "@/lib/server/entitlement-policy"
import { renderPlatformEmail } from "@/lib/server/notifications/messages"

const ORG = "11111111-1111-4111-8111-111111111111"

const row = (overrides: Partial<BillingHealthRow> = {}): BillingHealthRow => ({
  organisationId: ORG,
  deadEvents: 0,
  oldestDeadAt: null,
  deadErrorCode: null,
  syncFailures: 0,
  lastSyncErrorCode: null,
  lastSyncFailedAt: null,
  ...overrides,
})

describe("billing operator findings (R2B-06)", () => {
  const at = new Date("2026-10-14T08:00:00.000Z")

  it("reports a dead event per organisation with counts, instants and codes only", () => {
    expect(
      billingFindings([
        row({
          deadEvents: 2,
          oldestDeadAt: at,
          deadErrorCode: "stripe_unavailable",
        }),
      ])
    ).toEqual([
      {
        kind: "billing_event_dead",
        subject: ORG,
        details: {
          events: 2,
          oldestDeadAt: at.toISOString(),
          lastErrorCode: "stripe_unavailable",
        },
      },
    ])
  })

  it("waits for a run of failed syncs before billing_sync_failing", () => {
    const failing = (failures: number) =>
      billingFindings([
        row({
          syncFailures: failures,
          lastSyncErrorCode: "stripe_unavailable",
          lastSyncFailedAt: at,
        }),
      ])
    expect(failing(BILLING_SYNC_FAILING_AFTER - 1)).toEqual([])
    expect(failing(BILLING_SYNC_FAILING_AFTER)).toEqual([
      {
        kind: "billing_sync_failing",
        subject: ORG,
        details: {
          failures: BILLING_SYNC_FAILING_AFTER,
          lastErrorCode: "stripe_unavailable",
          lastFailedAt: at.toISOString(),
          failingAfter: BILLING_SYNC_FAILING_AFTER,
        },
      },
    ])
  })

  it("reports an unknown catalog price at the first failure, instead of the failing run", () => {
    const unknown = (failures: number) =>
      billingFindings([
        row({
          syncFailures: failures,
          lastSyncErrorCode: "billing_plan_unknown",
        }),
      ]).map((finding) => finding.kind)
    expect(unknown(1)).toEqual(["billing_plan_unknown"])
    expect(unknown(BILLING_SYNC_FAILING_AFTER + 2)).toEqual([
      "billing_plan_unknown",
    ])
  })

  it("names the organisation and the runbook in each operator email, nothing from Stripe", () => {
    for (const [kind, details] of [
      ["billing_event_dead", { events: 1, lastErrorCode: "x" }],
      ["billing_sync_failing", { failures: 3, lastErrorCode: "y" }],
      ["billing_plan_unknown", { failures: 1 }],
    ] as const) {
      const email = renderPlatformEmail(kind, ORG, details)
      expect(email.subject).toMatch(/^NabaPresence: /)
      expect(email.text).toContain(ORG)
      expect(email.text).toContain('docs/runbook.md, "Billing alerts"')
    }
  })
})

describe("newMemberLimit (R2B-04)", () => {
  const now = new Date("2026-10-14T08:00:00.000Z")
  const view = (
    overrides: {
      state?: "active" | "pilot"
      enforcementEnabled?: boolean
      memberLimit?: number | null
      pendingMemberLimit?: number | null
    } = {}
  ): OrganisationBillingView => ({
    billing: {
      organisationId: ORG,
      state: overrides.state ?? "active",
      planId: "plan",
      pendingPlanId: overrides.pendingMemberLimit === undefined ? null : "next",
      pendingEffectiveAt:
        overrides.pendingMemberLimit === undefined
          ? null
          : new Date("2026-11-01T00:00:00.000Z"),
      stripeCustomerId: "cus_x",
      stripeSubscriptionId: "sub_x",
      environment: "test",
      trialEndsAt: null,
      currentPeriodStart: new Date("2026-10-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      graceEndsAt: null,
      cancelAtPeriodEnd: false,
      firstPaymentSucceeded: true,
      enforcementEnabled: overrides.enforcementEnabled ?? true,
      version: 1,
    },
    plan: {
      locationLimit: 5,
      memberLimit:
        overrides.memberLimit === undefined ? 3 : overrides.memberLimit,
    },
    pendingPlan:
      overrides.pendingMemberLimit === undefined
        ? null
        : { locationLimit: 5, memberLimit: overrides.pendingMemberLimit },
  })

  it("binds the plan's limit only while both enforcement switches are on", () => {
    expect(newMemberLimit(view(), now, true)).toBe(3)
    expect(newMemberLimit(view(), now, false)).toBeNull()
    expect(
      newMemberLimit(view({ enforcementEnabled: false }), now, true)
    ).toBeNull()
  })

  it("never limits a pilot or a plan without a member limit", () => {
    expect(newMemberLimit(view({ state: "pilot" }), now, true)).toBeNull()
    expect(newMemberLimit(view({ memberLimit: null }), now, true)).toBeNull()
  })

  it("lets a scheduled downgrade bind new seats at once", () => {
    expect(newMemberLimit(view({ pendingMemberLimit: 2 }), now, true)).toBe(2)
    expect(newMemberLimit(view({ pendingMemberLimit: 5 }), now, true)).toBe(3)
    expect(
      newMemberLimit(
        view({ memberLimit: null, pendingMemberLimit: 2 }),
        now,
        true
      )
    ).toBe(2)
  })
})
