import { createHash, randomBytes, randomUUID } from "node:crypto"

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

  // ---------------------------------------------------------------------------
  // Explicit location scope (supabase 0063): written with the rows, never
  // apart from them. Reads still come from the rows; these pin the dual
  // write the readers will switch to.
  // ---------------------------------------------------------------------------

  async function scopeOf(organisationId: string, userId: string) {
    const [row] = await admin<{ locationScope: string; rows: number }[]>`
      select
        m.location_scope as "locationScope",
        (
          select count(*)::int from location_member lm
          where lm.organisation_id = m.organisation_id
            and lm.user_id = m.user_id
        ) as rows
      from member m
      where m.organisation_id = ${organisationId} and m.user_id = ${userId}
    `
    return row
  }

  async function putAccess(
    cookie: string,
    userId: string,
    body: Record<string, unknown>
  ) {
    return fetch(`${server.baseUrl}/api/members/${userId}/client-access`, {
      method: "PUT",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  }

  async function patchRole(
    cookie: string,
    userId: string,
    role: string,
    canPublish: boolean
  ) {
    return fetch(`${server.baseUrl}/api/members`, {
      method: "PATCH",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ userId, role, canPublish }),
    })
  }

  it("writes the location scope with the client-access rows", async () => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })
    await expect(scopeOf(owner.organisationId, member.userId)).resolves.toEqual(
      { locationScope: "all", rows: 0 }
    )

    const narrowed = await putAccess(owner.cookie, member.userId, {
      locations: [{ locationId: flagship, canPublish: true }],
    })
    expect(narrowed.status, await narrowed.clone().text()).toBe(200)
    await expect(scopeOf(owner.organisationId, member.userId)).resolves.toEqual(
      { locationScope: "assigned", rows: 1 }
    )

    const widened = await putAccess(owner.cookie, member.userId, {
      allClients: true,
    })
    expect(widened.status, await widened.clone().text()).toBe(200)
    await expect(scopeOf(owner.organisationId, member.userId)).resolves.toEqual(
      { locationScope: "all", rows: 0 }
    )

    const [audit] = await admin<{ metadata: Record<string, unknown> }[]>`
      select metadata from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'member.client_access_changed'
      order by created_at desc
      limit 1
    `
    expect(audit.metadata).toMatchObject({
      before: { locationScope: "assigned" },
      after: { locationScope: "all" },
    })
  })

  it("rolls the scope back with the rows when a client-access save fails", async () => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const member = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })
    // Fail the row insert, which runs after the scope update, for this one
    // member only: the save has then written 'assigned' and must lose it.
    const suffix = member.userId.replaceAll("-", "")
    const fn = `fail_location_member_${suffix}`
    await admin.unsafe(`
      create function ${fn}() returns trigger language plpgsql as $$
      begin
        if new.user_id = '${member.userId}'::uuid then
          raise exception 'injected location_member failure';
        end if;
        return new;
      end;
      $$;
      create trigger ${fn} before insert on location_member
        for each row execute function ${fn}();
    `)
    try {
      const refused = await putAccess(owner.cookie, member.userId, {
        locations: [{ locationId: flagship, canPublish: false }],
      })
      expect(refused.status).toBe(500)
    } finally {
      await admin.unsafe(`
        drop trigger if exists ${fn} on location_member;
        drop function if exists ${fn}();
      `)
    }
    await expect(scopeOf(owner.organisationId, member.userId)).resolves.toEqual(
      { locationScope: "all", rows: 0 }
    )
    const [audits] = await admin<{ count: number }[]>`
      select count(*)::int as count from audit_log
      where organisation_id = ${owner.organisationId}
        and action = 'member.client_access_changed'
    `
    expect(audits.count).toBe(0)
  })

  it("moves the scope with the role and keeps latent rows", async () => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const assigned = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: flagship,
    })
    const unassigned = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
    })

    // Promotion: owners and admins are every location; the row stays latent.
    expect(
      (await patchRole(owner.cookie, assigned.userId, "admin", true)).status
    ).toBe(200)
    await expect(
      scopeOf(owner.organisationId, assigned.userId)
    ).resolves.toEqual({ locationScope: "all", rows: 1 })

    // Demotion: the latent row becomes active again, as it always has.
    const demoted = await patchRole(
      owner.cookie,
      assigned.userId,
      "viewer",
      false
    )
    expect(demoted.status, await demoted.clone().text()).toBe(200)
    expect(
      ((await demoted.json()) as { member: { locationScope: string } }).member
        .locationScope
    ).toBe("assigned")
    await expect(
      scopeOf(owner.organisationId, assigned.userId)
    ).resolves.toEqual({ locationScope: "assigned", rows: 1 })

    // Demoting an admin with no rows leaves them seeing every location.
    expect(
      (await patchRole(owner.cookie, unassigned.userId, "admin", true)).status
    ).toBe(200)
    expect(
      (await patchRole(owner.cookie, unassigned.userId, "member", false)).status
    ).toBe(200)
    await expect(
      scopeOf(owner.organisationId, unassigned.userId)
    ).resolves.toEqual({ locationScope: "all", rows: 0 })

    // A member/viewer change keeps the scope it already has.
    expect(
      (await patchRole(owner.cookie, assigned.userId, "member", true)).status
    ).toBe(200)
    await expect(
      scopeOf(owner.organisationId, assigned.userId)
    ).resolves.toEqual({ locationScope: "assigned", rows: 1 })
  })

  it("extends a newly filed listing only to assigned holders", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const [client] = await admin<{ id: string }[]>`
      insert into client (organisation_id, name, slug)
      values (${owner.organisationId}, 'Old Crown', ${`old-crown-${randomUUID().slice(0, 8)}`})
      returning id::text as id
    `
    const first = await seedLocation(owner.organisationId, "Old Crown")
    await admin`update location set client_id = ${client.id} where id = ${first}`
    const holder = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: first,
    })
    // An admin holding the same listing: latent, scope 'all'.
    const latent = await seedMemberUser(admin, {
      organisationId: owner.organisationId,
      assignLocationId: first,
    })
    expect(
      (await patchRole(owner.cookie, latent.userId, "admin", true)).status
    ).toBe(200)

    const second = await seedLocation(owner.organisationId, "Old Crown annexe")
    const { withTenant } = await import("@/lib/server/db")
    const { extendClientHolders } = await import("@/lib/server/client-access")
    const extended = await withTenant(owner.organisationId, async (sql) => {
      await sql`update location set client_id = ${client.id} where id = ${second}`
      return extendClientHolders(sql, {
        organisationId: owner.organisationId,
        clientId: client.id,
        locationIds: [second],
      })
    })
    expect(extended.map((grant) => grant.userId)).toEqual([holder.userId])
  })
})
