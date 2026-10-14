import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedMemberUser,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

type Provisioning = typeof import("@/lib/server/provisioning")

/**
 * The plan's member limit (R2B-04): enforced when an invitation is created
 * (members plus open invitations) and when it is accepted (members, under
 * the billing row lock), under the same two switches as every entitlement,
 * and never for a pilot.
 */
describeDatabase("plan member limit", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let provisioning: Provisioning
  const organisations: string[] = []
  const plans: string[] = []
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10)

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    // Acceptance runs in this process (as in invitations.test.ts), so the
    // env hard override is switched on here as well as in the app server.
    process.env.BILLING_ENFORCEMENT_ENABLED = "true"
    provisioning = await import("@/lib/server/provisioning")
    server = await startAppServer({ BILLING_ENFORCEMENT_ENABLED: "true" })
  }, 60_000)

  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await admin`delete from billing_plan where id = any(${plans}::uuid[])`
    await admin.end()
  })

  /** A test plan version with this member limit (plan terms are immutable). */
  async function plan(memberLimit: number | null): Promise<string> {
    const [row] = await admin<{ id: string }[]>`
      insert into billing_plan (
        code, version, workspace_mode, environment, name, stripe_price_id,
        location_limit, member_limit, ai_draft_credits_per_period,
        is_test_offer, active
      )
      values (
        ${`ml_${plans.length}_${suffix}`}, 1, 'agency', 'test', 'Member limit (test)',
        ${`price_ml${plans.length}${suffix}`}, 5, ${memberLimit}, 40, true, true
      )
      returning id::text as id
    `
    plans.push(row.id)
    return row.id
  }

  /** An owner on an active paid plan with this member limit. */
  async function tenant(
    memberLimit: number | null,
    options: { enforced?: boolean; state?: "active" | "pilot" } = {}
  ) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const planId = await plan(memberLimit)
    const id = randomUUID().replace(/-/g, "").slice(0, 16)
    const active = (options.state ?? "active") === "active"
    await admin`
      update organisation_billing
      set state = ${options.state ?? "active"},
        plan_id = ${planId},
        environment = 'test',
        current_period_start = now() - interval '1 day',
        current_period_end = now() + interval '29 days',
        first_payment_succeeded = true,
        stripe_customer_id = ${`cus_ml${id}`},
        stripe_subscription_id = ${active ? `sub_ml${id}` : null},
        enforcement_enabled = ${options.enforced ?? true}
      where organisation_id = ${owner.organisationId}
    `
    return { ...owner, planId }
  }

  async function invite(owner: { cookie: string }, email = randomEmail()) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ email, role: "member", canPublish: false }),
    })
    return { response, email }
  }

  function randomEmail() {
    return `member-limit-${randomUUID()}@nabapresence.test`
  }

  async function invitationFor(email: string) {
    const [row] = await admin<
      {
        id: string
        organisationId: string
        role: string
        canPublish: boolean
      }[]
    >`
      select id::text as id, organisation_id::text as "organisationId",
        role, can_publish as "canPublish"
      from invitation where email = ${email}
    `
    return row
  }

  function accept(
    email: string,
    invitation: Awaited<ReturnType<typeof invitationFor>>
  ) {
    return provisioning.provisionAuthenticatedMember(
      {
        provider: "supabase",
        subject: `member-limit-${randomUUID()}`,
        email,
        displayName: "Invited member",
        emailVerified: true,
      },
      invitation,
      randomUUID()
    )
  }

  const members = async (organisationId: string) => {
    const [row] = await admin<{ count: number }[]>`
      select count(*)::int as count from member
      where organisation_id = ${organisationId}
    `
    return row.count
  }

  it("refuses an invitation once members and open invitations fill the plan", async () => {
    const owner = await tenant(2)
    const first = await invite(owner)
    expect(first.response.status, await first.response.clone().text()).toBe(201)

    const second = await invite(owner)
    expect(second.response.status).toBe(402)
    expect(await second.response.json()).toMatchObject({
      error: "member_limit_reached",
      details: { limit: 2 },
    })
    expect(await invitationFor(second.email)).toBeUndefined()

    // Revoking the open invitation frees its seat.
    await admin`delete from invitation where email = ${first.email}`
    expect((await invite(owner)).response.status).toBe(201)
  })

  it("refuses an acceptance when the plan filled up since the invitation was sent", async () => {
    const owner = await tenant(2)
    const { response, email } = await invite(owner)
    expect(response.status).toBe(201)
    await seedMemberUser(admin, { organisationId: owner.organisationId })
    const invitation = await invitationFor(email)

    await expect(accept(email, invitation)).rejects.toMatchObject({
      status: 402,
      code: "member_limit_reached",
    })
    expect(await members(owner.organisationId)).toBe(2)
    const [row] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation where id = ${invitation.id}
    `
    expect(row.acceptedAt).toBeNull()
  })

  it("refuses a signed-in acceptance over the limit too", async () => {
    const owner = await tenant(2)
    // Someone who already belongs to another organisation, signed in.
    const other = await createTestTenant(admin)
    organisations.push(other.organisationId)
    const { response } = await invite(owner, other.email)
    expect(response.status).toBe(201)
    await seedMemberUser(admin, { organisationId: owner.organisationId })

    await expect(
      provisioning.acceptInvitationForSessionUser(
        { userId: other.userId, email: other.email },
        await invitationFor(other.email),
        randomUUID()
      )
    ).rejects.toMatchObject({ status: 402, code: "member_limit_reached" })
    expect(await members(owner.organisationId)).toBe(2)
  })

  it("accepts within the limit", async () => {
    const owner = await tenant(2)
    const { email } = await invite(owner)
    const accepted = await accept(email, await invitationFor(email))
    expect(accepted.organisationId).toBe(owner.organisationId)
    expect(await members(owner.organisationId)).toBe(2)
  })

  it("lets only one of two acceptances racing for the last seat in", async () => {
    const owner = await tenant(3)
    const a = await invite(owner)
    const b = await invite(owner)
    expect([a.response.status, b.response.status]).toEqual([201, 201])
    // One seat left for two open invitations: move to a two-seat plan.
    await admin`
      update organisation_billing set plan_id = ${await plan(2)}
      where organisation_id = ${owner.organisationId}
    `

    const results = await Promise.allSettled([
      accept(a.email, await invitationFor(a.email)),
      accept(b.email, await invitationFor(b.email)),
    ])
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1)
    const [refused] = results.filter((r) => r.status === "rejected")
    expect((refused as PromiseRejectedResult).reason).toMatchObject({
      code: "member_limit_reached",
    })
    expect(await members(owner.organisationId)).toBe(2)
  })

  it("does not limit a plan without a member limit, an unenforced organisation or a pilot", async () => {
    for (const owner of [
      await tenant(null),
      await tenant(1, { enforced: false }),
      await tenant(1, { state: "pilot" }),
    ]) {
      const { response, email } = await invite(owner)
      expect(response.status, await response.clone().text()).toBe(201)
      await accept(email, await invitationFor(email))
      expect(await members(owner.organisationId)).toBe(2)
    }
  })
})
