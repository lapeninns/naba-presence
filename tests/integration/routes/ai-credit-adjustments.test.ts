import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const CRON = { authorization: "Bearer route-harness-cron-secret" }

/**
 * The operator AI credit endpoints through the real route (plan P07-S7):
 * an adjustment adds to the current period, is audited with its operator
 * and reason, never resets used credits, is idempotent on its reference and
 * fails closed; the monthly override stays for pilots only.
 */
describeDatabase("operator AI credit adjustments", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const tenants: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer({ AI_MONTHLY_DRAFT_CREDITS: "3" })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, tenants)
    await admin.end()
  })

  async function tenant() {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    tenants.push(owner.organisationId)
    return owner
  }

  function call(
    method: string,
    organisationId: string,
    body?: unknown,
    headers: Record<string, string> = CRON
  ) {
    return fetch(
      `${server.baseUrl}/api/operations/organisations/${organisationId}/ai-credits`,
      {
        method,
        headers: { ...headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }
    )
  }

  const grant = (overrides: Record<string, unknown> = {}) => ({
    credits: 4,
    reason: "Goodwill credit after the sync outage",
    operator: "support@nabapresence.test",
    reference: "ZD-2001",
    ...overrides,
  })

  /** Spends `n` credits of the current period as settled drafts. */
  async function spend(organisationId: string, periodId: string, n: number) {
    for (let i = 0; i < n; i += 1) {
      await admin`
        insert into ai_usage (
          organisation_id, kind, status, credits, model, request_id,
          period_start, credit_period_id
        )
        values (
          ${organisationId}, 'draft', 'settled', 1, 'test-model',
          ${`spent-${crypto.randomUUID()}`},
          (date_trunc('month', now() at time zone 'utc'))::date,
          ${periodId}
        )
      `
    }
  }

  it("refuses without the operator bearer", async () => {
    const owner = await tenant()
    for (const method of ["GET", "POST", "PUT"]) {
      const response = await call(
        method,
        owner.organisationId,
        method === "GET" ? undefined : grant(),
        { cookie: owner.cookie }
      )
      expect(response.status, method).toBe(401)
    }
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from ai_credit_period
      where organisation_id = ${owner.organisationId} and kind = 'adjustment'
    `
    expect(n).toBe(0)
  })

  it("adds to the current period, audited, without resetting used credits", async () => {
    const owner = await tenant()
    const before = await call("GET", owner.organisationId)
    expect(before.status).toBe(200)
    const view = await before.json()
    expect(view).toMatchObject({
      credits: { used: 0, allowance: 3, periodKind: "pilot_month" },
      adjustments: [],
    })
    await spend(owner.organisationId, view.credits.periodId, 3)

    const response = await call("POST", owner.organisationId, grant())
    expect(response.status, await response.clone().text()).toBe(200)
    const body = await response.json()
    expect(body).toMatchObject({
      replayed: false,
      credits: { used: 3, allowance: 7, remaining: 4 },
      adjustment: {
        periodId: view.credits.periodId,
        periodKind: "pilot_month",
        credits: 4,
        reason: "Goodwill credit after the sync outage",
        operator: "support@nabapresence.test",
        reference: "ZD-2001",
        periodEnd: view.credits.periodEnd,
        current: true,
      },
    })
    expect(body.adjustments).toEqual([body.adjustment])

    // Used credits are untouched: the grant only raises the allowance.
    const [usage] = await admin<{ n: number }[]>`
      select count(*)::int as n from ai_usage
      where organisation_id = ${owner.organisationId}
        and status = 'settled' and credits = 1
    `
    expect(usage.n).toBe(3)
    const [row] = await admin<
      {
        kind: string
        allowance: number
        applies: string
        reason: string
        grantedBy: string
        startsAt: Date
        endsAt: Date
      }[]
    >`
      select a.kind, a.allowance, a.applies_to_period_id::text as applies,
        a.reason, a.granted_by as "grantedBy",
        a.starts_at = p.starts_at as "startsAt",
        a.ends_at = p.ends_at as "endsAt"
      from ai_credit_period a
      join ai_credit_period p on p.id = a.applies_to_period_id
      where a.organisation_id = ${owner.organisationId}
        and a.kind = 'adjustment'
    `
    expect(row).toMatchObject({
      kind: "adjustment",
      allowance: 4,
      applies: view.credits.periodId,
      reason: "Goodwill credit after the sync outage",
      grantedBy: "support@nabapresence.test",
      startsAt: true,
      endsAt: true,
    })

    const audits = await admin<
      { subjectId: string; metadata: Record<string, unknown> }[]
    >`
      select subject_id as "subjectId", metadata from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'ai_credits.adjustment_granted'
    `
    expect(audits).toEqual([
      {
        subjectId: body.adjustment.id,
        metadata: expect.objectContaining({
          periodId: view.credits.periodId,
          credits: 4,
          allowanceBefore: 3,
          usedBefore: 3,
          reason: "Goodwill credit after the sync outage",
          reference: "ZD-2001",
        }),
      },
    ])
  })

  it("replays a repeated reference and refuses a different grant under it", async () => {
    const owner = await tenant()
    const first = await (
      await call("POST", owner.organisationId, grant())
    ).json()
    const again = await call("POST", owner.organisationId, grant())
    expect(again.status).toBe(200)
    expect(await again.json()).toMatchObject({
      replayed: true,
      adjustment: first.adjustment,
      credits: { allowance: 7 },
    })
    const conflict = await call(
      "POST",
      owner.organisationId,
      grant({ credits: 40 })
    )
    expect(conflict.status).toBe(409)
    expect(await conflict.json()).toMatchObject({
      error: "ai_credit_adjustment_conflict",
    })
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'ai_credits.adjustment_granted'
    `
    expect(n).toBe(1)
  })

  it("rejects invalid grants and an unknown organisation", async () => {
    const owner = await tenant()
    for (const body of [
      grant({ credits: 0 }),
      grant({ credits: -3 }),
      grant({ reason: "short" }),
      grant({ operator: undefined }),
      grant({ reference: "bad ref" }),
    ]) {
      const response = await call("POST", owner.organisationId, body)
      expect(response.status, JSON.stringify(body)).toBe(400)
    }
    const missing = await call("POST", crypto.randomUUID(), grant())
    expect(missing.status).toBe(404)
  })

  it("fails closed when billing has not granted a current period", async () => {
    const owner = await tenant()
    await admin`
      update organisation_billing
      set state = 'read_only'
      where organisation_id = ${owner.organisationId}
    `
    const response = await call("POST", owner.organisationId, grant())
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({
      error: "ai_credit_period_missing",
    })
    const [{ n }] = await admin<{ n: number }[]>`
      select count(*)::int as n from ai_credit_period
      where organisation_id = ${owner.organisationId}
    `
    expect(n).toBe(0)
  })

  it("keeps the monthly override for pilots only", async () => {
    const owner = await tenant()
    const set = await call("PUT", owner.organisationId, {
      monthlyDraftCredits: 9,
    })
    expect(set.status).toBe(200)
    expect(await set.json()).toMatchObject({ allowance: 9 })

    await admin`
      update organisation_billing
      set state = 'read_only'
      where organisation_id = ${owner.organisationId}
    `
    const refused = await call("PUT", owner.organisationId, {
      monthlyDraftCredits: 50,
    })
    expect(refused.status).toBe(409)
    expect(await refused.json()).toMatchObject({
      error: "ai_credits_override_pilot_only",
      details: { state: "read_only" },
    })
    const [org] = await admin<{ override: number | null }[]>`
      select ai_monthly_draft_credits as override from organisation
      where id = ${owner.organisationId}
    `
    expect(org.override).toBe(9)
    // Clearing a stale override is always allowed.
    const cleared = await call("PUT", owner.organisationId, {
      monthlyDraftCredits: null,
    })
    expect(cleared.status).toBe(200)
    const [after] = await admin<{ override: number | null }[]>`
      select ai_monthly_draft_credits as override from organisation
      where id = ${owner.organisationId}
    `
    expect(after.override).toBeNull()
  })
  // NP1-G03 / NP8-G10: the chart's per-day read, through the real route
  // with two tenants spending in the same day.
  it("returns only the caller's organisation in the daily spend", async () => {
    const a = await tenant()
    const b = await tenant()
    const periodOf = async (organisationId: string) => {
      const response = await call("GET", organisationId)
      expect(response.status).toBe(200)
      return ((await response.json()) as { credits: { periodId: string } })
        .credits.periodId
    }
    await spend(a.organisationId, await periodOf(a.organisationId), 2)
    // B's spend is legacy: no period id, counted by the pilot month it
    // names. The month alone would match A's month too, so only the
    // organisation keeps it out of A's chart.
    await periodOf(b.organisationId)
    for (let i = 0; i < 3; i += 1) {
      await admin`
        insert into ai_usage (
          organisation_id, kind, status, credits, model, request_id,
          period_start
        )
        values (
          ${b.organisationId}, 'draft', 'settled', 1, 'test-model',
          ${`legacy-${crypto.randomUUID()}`},
          (date_trunc('month', now() at time zone 'utc'))::date
        )
      `
    }

    const daily = async (cookie?: string) =>
      fetch(`${server.baseUrl}/api/ai/credits/daily`, {
        headers: cookie ? { cookie } : {},
      })
    const total = (body: { days: { credits: number }[] }) =>
      body.days.reduce((sum, day) => sum + day.credits, 0)

    const forA = await daily(a.cookie)
    expect(forA.status, await forA.clone().text()).toBe(200)
    const bodyA = (await forA.json()) as {
      days: { date: string; credits: number }[]
    }
    // Spent just now: one day carries it, whichever UTC day that was.
    expect(bodyA.days.filter((day) => day.credits > 0)).toEqual([
      { date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), credits: 2 },
    ])
    expect(total(bodyA)).toBe(2)

    const forB = await daily(b.cookie)
    expect(forB.status).toBe(200)
    expect(total(await forB.json())).toBe(3)

    expect((await daily()).status).toBe(401)
  })
})
