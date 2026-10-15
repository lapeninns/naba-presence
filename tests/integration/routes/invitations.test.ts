import { createHash, randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { startAppServer } from "../helpers/app-server"
import { createTestTenant, destroyTenants } from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex")

type InvitationRow = {
  id: string
  organisationId: string
  email: string
  role: "owner" | "admin" | "member" | "viewer"
  canPublish: boolean
  tokenHash: string
  expiresAt: Date
  acceptedAt: Date | null
}

// Acceptance runs through provisionAuthenticatedMember, the function
// completeEmailAuthentication actually calls. The suite used to drive these
// branches through provisionMember, a Google twin no route could reach and
// which never had the invited-email check.
function acceptorIdentity(email: string) {
  return {
    provider: "supabase",
    subject: `invite-subject-${randomUUID()}`,
    email,
    displayName: "Invited member",
    emailVerified: true,
  }
}

describeDatabase("organisation invitations", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
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

  async function createInvitation(
    owner: Awaited<ReturnType<typeof createTestTenant>>,
    overrides: {
      email?: string
      role?: "owner" | "admin" | "member" | "viewer"
      canPublish?: boolean
    } = {}
  ) {
    const email =
      overrides.email ?? `harness-invite-${randomUUID()}@nabapresence.test`
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        role: overrides.role ?? "member",
        canPublish: overrides.canPublish ?? true,
      }),
    })
    const body = (await response.json()) as {
      inviteUrl: string
      invitation?: Record<string, unknown>
      error?: string
    }
    return { response, body, email }
  }

  async function invitationByEmail(email: string) {
    const [row] = await admin<InvitationRow[]>`
      select
        id::text as id,
        organisation_id::text as "organisationId",
        email,
        role,
        can_publish as "canPublish",
        token_hash as "tokenHash",
        expires_at as "expiresAt",
        accepted_at as "acceptedAt"
      from invitation
      where email = ${email}
      limit 1
    `
    return row
  }

  it("creates a seven-day token invitation without creating a user", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner)

    expect(response.status, JSON.stringify(body)).toBe(201)
    const token = new URL(body.inviteUrl).pathname.split("/").at(-1)
    expect(token).toHaveLength(43)
    const invitation = await invitationByEmail(email)
    expect(invitation.tokenHash).toBe(tokenHash(token!))
    expect(invitation.expiresAt.getTime()).toBeGreaterThan(
      Date.now() + 6.9 * 24 * 60 * 60 * 1000
    )
    expect(invitation.expiresAt.getTime()).toBeLessThan(
      Date.now() + 7.1 * 24 * 60 * 60 * 1000
    )
    const [user] = await admin<{ count: number }[]>`
      select count(*)::int as count from app_user where email = ${email}
    `
    expect(user.count).toBe(0)

    const list = await fetch(`${server.baseUrl}/api/invitations`, {
      headers: { cookie: owner.cookie },
    })
    expect(list.status, await list.clone().text()).toBe(200)
    expect(await list.json()).toMatchObject({
      items: [
        {
          email,
          role: "member",
          canPublish: true,
        },
      ],
    })
  })

  it("looks up a pending invitation without a session", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner)
    expect(response.status, JSON.stringify(body)).toBe(201)
    const token = new URL(body.inviteUrl).pathname.split("/").at(-1)

    const lookup = await fetch(`${server.baseUrl}/api/invitations/${token}`)
    expect(lookup.status, await lookup.clone().text()).toBe(200)
    const stored = await invitationByEmail(email)
    const answer = await lookup.json()
    // Exactly the public keys (D8), the stored role and the stored expiry as
    // ISO: nothing else about the invitation is readable by token alone.
    expect(Object.keys(answer).sort()).toEqual([
      "accepted",
      "email",
      "expired",
      "expiresAt",
      "organisationName",
      "role",
    ])
    expect(answer).toEqual({
      organisationName: "Harness tenant",
      email,
      role: "member",
      expiresAt: new Date(stored.expiresAt).toISOString(),
      accepted: false,
      expired: false,
    })
    expect(new Date(answer.expiresAt).getTime()).toBeGreaterThan(Date.now())
    expect(stored.role).toBe(answer.role)
  })

  it("accepts once into the inviting organisation", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner, {
      role: "member",
      canPublish: true,
    })
    expect(response.status, JSON.stringify(body)).toBe(201)
    const invitation = await invitationByEmail(email)
    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")

    const accepted = await provisionAuthenticatedMember(
      acceptorIdentity(email),
      invitation,
      randomUUID()
    )
    expect(accepted.organisationId).toBe(owner.organisationId)
    const [membership] = await admin<
      {
        role: string
        canPublish: boolean
        defaultOrganisationId: string | null
        acceptedAt: Date | null
      }[]
    >`
      select
        m.role,
        m.can_publish as "canPublish",
        u.default_organisation_id::text as "defaultOrganisationId",
        i.accepted_at as "acceptedAt"
      from member m
      join app_user u on u.id = m.user_id
      join invitation i on i.id = ${invitation.id}
      where m.organisation_id = ${owner.organisationId}
        and m.user_id = ${accepted.userId}
    `
    expect(membership).toMatchObject({
      role: "member",
      canPublish: true,
      defaultOrganisationId: owner.organisationId,
    })
    expect(membership.acceptedAt).toBeInstanceOf(Date)
    await expect(
      provisionAuthenticatedMember(
        acceptorIdentity(email),
        invitation,
        randomUUID()
      )
    ).rejects.toMatchObject({ code: "invitation_already_used" })
  })

  it("refuses an invitation addressed to a different verified email", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner)
    expect(response.status, JSON.stringify(body)).toBe(201)
    const invitation = await invitationByEmail(email)
    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")
    const otherEmail = `harness-other-${randomUUID()}@nabapresence.test`

    await expect(
      provisionAuthenticatedMember(
        acceptorIdentity(otherEmail),
        invitation,
        randomUUID()
      )
    ).rejects.toMatchObject({ code: "invitation_email_mismatch" })
    const [joined] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from member m
      join app_user u on u.id = m.user_id
      where m.organisation_id = ${owner.organisationId}
        and u.email = ${otherEmail}
    `
    expect(joined.count).toBe(0)
  })

  it("refuses to invite someone who is already in the organisation", async () => {
    const owner = await fixture()
    // The owner's own address: accepting used to upsert over the membership,
    // so a re-invitation as 'viewer' left the organisation ownerless.
    const { response, body } = await createInvitation(owner, {
      email: owner.email,
      role: "viewer",
      canPublish: false,
    })

    expect(response.status, JSON.stringify(body)).toBe(409)
    expect(body.error).toBe("already_a_member")
    const [owners] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from member
      where organisation_id = ${owner.organisationId} and role = 'owner'
    `
    expect(owners.count).toBe(1)
  })

  it("reports and rejects expired invitations", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner)
    expect(response.status, JSON.stringify(body)).toBe(201)
    const token = new URL(body.inviteUrl).pathname.split("/").at(-1)
    const invitation = await invitationByEmail(email)
    await admin`
      update invitation
      set expires_at = now() - interval '1 minute'
      where id = ${invitation.id}
    `

    const lookup = await fetch(`${server.baseUrl}/api/invitations/${token}`)
    expect(lookup.status, await lookup.clone().text()).toBe(200)
    expect(await lookup.json()).toMatchObject({
      accepted: false,
      expired: true,
    })
    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")
    await expect(
      provisionAuthenticatedMember(
        acceptorIdentity(email),
        invitation,
        randomUUID()
      )
    ).rejects.toMatchObject({ code: "invitation_expired" })
  })

  it("rejects duplicate pending invitations", async () => {
    const owner = await fixture()
    const email = `harness-duplicate-${randomUUID()}@nabapresence.test`
    const first = await createInvitation(owner, { email })
    expect(first.response.status, JSON.stringify(first.body)).toBe(201)
    const duplicate = await createInvitation(owner, { email })
    expect(duplicate.response.status).toBe(409)
    expect(duplicate.body.error).toBe("invitation_pending")
  })

  it("retires direct member creation with a 410 response", async () => {
    const owner = await fixture()
    const email = `harness-direct-${randomUUID()}@nabapresence.test`
    const response = await fetch(`${server.baseUrl}/api/members`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        email,
        displayName: "Direct member",
        role: "member",
        canPublish: false,
      }),
    })

    expect(response.status).toBe(410)
    expect((await response.json()).error).toBe("use_invitations")
    const [user] = await admin<{ count: number }[]>`
      select count(*)::int as count from app_user where email = ${email}
    `
    expect(user.count).toBe(0)
  })

  // ---------------------------------------------------------------------------
  // Location scope (supabase 0082): a business workspace can invite a member
  // or viewer for named listings, and the scope travels with the invitation
  // onto the membership, in the acceptance transaction.
  // ---------------------------------------------------------------------------

  async function seedLocation(organisationId: string, name: string) {
    const id = randomUUID()
    await admin`
      insert into location (id, organisation_id, name)
      values (${id}, ${organisationId}, ${name})
    `
    return id
  }

  async function inviteForLocations(
    owner: Awaited<ReturnType<typeof createTestTenant>>,
    body: Record<string, unknown>
  ) {
    const email = `harness-scoped-${randomUUID()}@nabapresence.test`
    const response = await fetch(`${server.baseUrl}/api/invitations`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ email, role: "member", ...body }),
    })
    return {
      response,
      body: (await response.json()) as {
        invitation?: Record<string, unknown>
        error?: string
      },
      email,
    }
  }

  async function scopeRow(email: string) {
    const [row] = await admin<
      { locationIds: string[] | null; locationScope: string }[]
    >`
      select
        location_ids::text[] as "locationIds",
        location_scope as "locationScope"
      from invitation
      where email = ${email}
    `
    return row
  }

  it("accepts a client-scoped invitation written without a scope, as the deployed code writes it", async () => {
    // 0082 runs before the release that writes location_scope is deployed;
    // the older POST sets client_ids and leaves the scope to the default.
    const owner = await fixture()
    const email = `old-writer-${randomUUID()}@example.test`
    await admin`
      insert into invitation (
        organisation_id, email, role, token_hash, token_ciphertext,
        expires_at, client_ids
      ) values (
        ${owner.organisationId}, ${email}, 'viewer',
        ${randomUUID()}, ${Buffer.from("x")},
        now() + interval '7 days', ${admin.array([randomUUID()])}::uuid[]
      )
    `
    await expect(scopeRow(email)).resolves.toEqual({
      locationIds: null,
      locationScope: "assigned",
    })
  })

  it("stores an unscoped invitation as scope all and copies it on acceptance", async () => {
    const owner = await fixture()
    const { response, body, email } = await createInvitation(owner)
    expect(response.status, JSON.stringify(body)).toBe(201)
    expect(body.invitation).toMatchObject({ locationScope: "all" })
    await expect(scopeRow(email)).resolves.toEqual({
      locationIds: null,
      locationScope: "all",
    })
    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")
    const accepted = await provisionAuthenticatedMember(
      acceptorIdentity(email),
      await invitationByEmail(email),
      randomUUID()
    )
    const [member] = await admin<{ locationScope: string }[]>`
      select location_scope as "locationScope" from member
      where organisation_id = ${owner.organisationId}
        and user_id = ${accepted.userId}
    `
    expect(member.locationScope).toBe("all")
  })

  it("scopes a business invitation to named locations, atomically on acceptance", async () => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const annexe = await seedLocation(owner.organisationId, "Annexe")

    const { response, body, email } = await inviteForLocations(owner, {
      canPublish: true,
      locationIds: [flagship, flagship.toUpperCase()],
    })
    expect(response.status, JSON.stringify(body)).toBe(201)
    expect(body.invitation).toMatchObject({
      locationScope: "assigned",
      locations: [{ id: flagship, name: "Flagship" }],
      clients: null,
    })
    await expect(scopeRow(email)).resolves.toEqual({
      locationIds: [flagship],
      locationScope: "assigned",
    })

    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")
    const accepted = await provisionAuthenticatedMember(
      acceptorIdentity(email),
      await invitationByEmail(email),
      randomUUID()
    )
    const [member] = await admin<{ locationScope: string }[]>`
      select location_scope as "locationScope" from member
      where organisation_id = ${owner.organisationId}
        and user_id = ${accepted.userId}
    `
    expect(member.locationScope).toBe("assigned")
    const grants = await admin<{ locationId: string; canPublish: boolean }[]>`
      select location_id::text as "locationId", can_publish as "canPublish"
      from location_member
      where organisation_id = ${owner.organisationId}
        and user_id = ${accepted.userId}
    `
    expect(grants).toEqual([{ locationId: flagship, canPublish: true }])
    expect(grants.some((grant) => grant.locationId === annexe)).toBe(false)
  })

  it("refuses a location scope on an owner or admin, in an agency workspace, or for another organisation's listing", async () => {
    const business = await createTestTenant(admin, {
      workspaceMode: "business",
    })
    organisations.push(business.organisationId)
    const flagship = await seedLocation(business.organisationId, "Flagship")

    const adminInvite = await inviteForLocations(business, {
      role: "admin",
      locationIds: [flagship],
    })
    expect(adminInvite.response.status).toBe(409)
    expect(adminInvite.body.error).toBe("role_sees_all_clients")

    const agency = await fixture()
    const agencyListing = await seedLocation(agency.organisationId, "Agency")
    const agencyInvite = await inviteForLocations(agency, {
      locationIds: [agencyListing],
    })
    expect(agencyInvite.response.status).toBe(409)
    expect(agencyInvite.body.error).toBe("wrong_workspace_mode")

    const foreign = await inviteForLocations(business, {
      locationIds: [agencyListing],
    })
    expect(foreign.response.status).toBe(404)
    expect(foreign.body.error).toBe("location_not_found")

    const both = await inviteForLocations(business, {
      locationIds: [flagship],
      clientIds: [randomUUID()],
    })
    expect(both.response.status).toBe(400)
  })

  it("refuses an assigned invitation whose locations have all gone, creating no membership", async () => {
    const owner = await createTestTenant(admin, { workspaceMode: "business" })
    organisations.push(owner.organisationId)
    const flagship = await seedLocation(owner.organisationId, "Flagship")
    const { response, body, email } = await inviteForLocations(owner, {
      role: "viewer",
      locationIds: [flagship],
    })
    expect(response.status, JSON.stringify(body)).toBe(201)
    await admin`delete from location where id = ${flagship}`

    const { provisionAuthenticatedMember } =
      await import("@/lib/server/provisioning")
    const invitation = await invitationByEmail(email)
    await expect(
      provisionAuthenticatedMember(
        acceptorIdentity(email),
        invitation,
        randomUUID()
      )
    ).rejects.toMatchObject({ status: 409, code: "invitation_scope_empty" })
    const [members] = await admin<{ count: number }[]>`
      select count(*)::int as count
      from member m
      join app_user u on u.id = m.user_id
      where m.organisation_id = ${owner.organisationId}
        and lower(u.email) = ${email}
    `
    expect(members.count).toBe(0)
    const [still] = await admin<{ acceptedAt: Date | null }[]>`
      select accepted_at as "acceptedAt" from invitation where id = ${invitation.id}
    `
    expect(still.acceptedAt).toBeNull()
  })
})
