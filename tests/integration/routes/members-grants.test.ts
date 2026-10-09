import { createHash, randomBytes, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

describeDatabase("member removal, location grants and the last owner", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 2 })
    server = await startAppServer()
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    return owner
  }

  async function seedLocation(organisationId: string, name: string) {
    const id = randomUUID()
    await admin`
      insert into location (id, organisation_id, name)
      values (${id}, ${organisationId}, ${name})
    `
    return id
  }

  async function invite(
    owner: Awaited<ReturnType<typeof createTestTenant>>,
    input: { email: string; canPublish: boolean }
  ) {
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        role: "member",
        canPublish: input.canPublish,
      }),
    })
    expect(response.status, await response.clone().text()).toBe(201)
    const [invitation] = await admin<
      {
        id: string
        organisationId: string
        role: string
        canPublish: boolean
      }[]
    >`
      select
        id::text as id,
        organisation_id::text as "organisationId",
        role,
        can_publish as "canPublish"
      from invitation
      where email = ${input.email} and accepted_at is null
      limit 1
    `
    return invitation
  }

  it("does not resurrect a removed member's location grants", async () => {
    const owner = await fixture()
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const annexe = await seedLocation(owner.organisationId, "Annexe")
    const email = `harness-grant-${randomUUID()}@nabapresence.test`
    // One identity throughout: the same person is invited, removed and
    // invited again, which is the scenario the stale grants survived.
    const identity = {
      provider: "supabase",
      subject: `grant-subject-${randomUUID()}`,
      email,
      displayName: "Grant holder",
      emailVerified: true,
    }
    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")

    const accepted = await provisionAuthenticatedMember(
      identity,
      await invite(owner, { email, canPublish: true }),
      randomUUID()
    )
    // A per-location grant, seeded directly: the removal below is what is
    // under test, not how the grant was made.
    await admin`
      insert into location_member (
        organisation_id, location_id, user_id, can_publish
      )
      values (
        ${owner.organisationId}, ${flagship}, ${accepted.userId}, true
      )
    `

    const removal = await fetch(`${server.baseUrl}/api/members`, {
      method: "DELETE",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ userId: accepted.userId }),
    })
    expect(removal.status, await removal.clone().text()).toBe(200)
    const [orphaned] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from location_member
      where organisation_id = ${owner.organisationId}
        and user_id = ${accepted.userId}
    `
    expect(orphaned.count).toBe(0)

    // The deliberate downgrade: re-invited with no publish rights at all.
    await provisionAuthenticatedMember(
      identity,
      await invite(owner, { email, canPublish: false }),
      randomUUID()
    )
    const [membership] = await admin<{ role: string; canPublish: boolean }[]>`
      select role, can_publish as "canPublish"
      from member
      where organisation_id = ${owner.organisationId}
        and user_id = ${accepted.userId}
    `
    expect(membership).toEqual({ role: "member", canPublish: false })

    const { withTenant } = await import("@/lib/server/db")
    const { grantsFor } = await import("@/lib/server/permissions")
    const grants = await withTenant(owner.organisationId, (sql) =>
      grantsFor(
        sql,
        {
          role: "member",
          userId: accepted.userId,
          canPublish: membership.canPublish,
        },
        [flagship, annexe]
      )
    )
    // A surviving location_member row made hasAssignments true, which
    // discards the organisation-level can_publish entirely: the re-invited
    // member could publish to the flagship and could not see the annexe.
    expect(grants.get(flagship)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
    expect(grants.get(annexe)).toEqual({
      visible: true,
      canEdit: true,
      canPublish: false,
    })
  })

  it("refuses the second of two concurrent owner demotions", async () => {
    const first = await fixture()
    const secondUserId = randomUUID()
    const secondToken = randomBytes(32).toString("base64url")
    await admin`
      insert into app_user (id, email, display_name, default_organisation_id)
      values (
        ${secondUserId},
        ${`harness-owner-${secondUserId.slice(0, 8)}@nabapresence.test`},
        'Second owner',
        ${first.organisationId}
      )
    `
    await admin`
      insert into member (organisation_id, user_id, role, can_publish)
      values (${first.organisationId}, ${secondUserId}, 'owner', true)
    `
    await admin`
      insert into app_session (token_hash, user_id, organisation_id, expires_at)
      values (
        ${createHash("sha256").update(secondToken).digest("hex")},
        ${secondUserId},
        ${first.organisationId},
        now() + interval '1 hour'
      )
    `

    const demote = (cookie: string, userId: string) =>
      fetch(`${server.baseUrl}/api/members`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ userId, role: "admin", canPublish: true }),
      })

    // Each owner demotes the other at the same instant. Without the row lock
    // both transactions read "two owners", both committed, and the
    // organisation was left with none - unrecoverable, because only an owner
    // can grant `owner`.
    const [a, b] = await Promise.all([
      demote(first.cookie, secondUserId),
      demote(`naba_session=${secondToken}`, first.userId),
    ])

    const statuses = [a.status, b.status]
    expect(statuses.filter((status) => status === 200)).toHaveLength(1)
    // A clean 4xx refusal, not the database trigger rescuing a 500.
    const refused = statuses.find((status) => status !== 200)!
    expect(refused).toBeGreaterThanOrEqual(400)
    expect(refused).toBeLessThan(500)
    const [owners] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from member
      where organisation_id = ${first.organisationId} and role = 'owner'
    `
    expect(owners.count).toBe(1)
  })
})
