import { randomBytes, randomUUID, createHash } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { locationCapabilitiesSchema } from "@/lib/contracts/location-capabilities"

import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

// Seed an extra user with a given role in an existing org, returning a cookie.
async function seedMemberUser(
  admin: ReturnType<typeof postgres>,
  organisationId: string,
  role: "owner" | "admin" | "member" | "viewer",
  canPublish: boolean
) {
  const userId = randomUUID()
  const token = randomBytes(32).toString("base64url")
  await admin`
    insert into app_user (id, email, display_name, default_organisation_id)
    values (${userId}, ${`cap-${userId.slice(0, 8)}@nabapresence.test`}, 'Cap user', ${organisationId})
  `
  await admin`
    insert into member (organisation_id, user_id, role, can_publish)
    values (${organisationId}, ${userId}, ${role}, ${canPublish})
  `
  await admin`
    insert into app_session (token_hash, user_id, organisation_id, expires_at)
    values (${hashToken(token)}, ${userId}, ${organisationId}, now() + interval '1 hour')
  `
  return { userId, cookie: `naba_session=${token}` }
}

describeDatabase("per-location capabilities route", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  async function caps(cookie: string, locationId: string) {
    const response = await fetch(
      `${server.baseUrl}/api/locations/${locationId}/capabilities`,
      { headers: { cookie } }
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    return { capabilities: locationCapabilitiesSchema.parse(body.capabilities) }
  }

  function expectCaps(
    actual: {
      canEditCanonical: boolean
      canPublish: boolean
      resources?: Record<string, { state: string; reasonCode?: string }>
    },
    expected: {
      canEditCanonical: boolean
      canPublish: boolean
      canEdit?: boolean
      canRequestApproval?: boolean
      canDecideApproval?: boolean
    }
  ) {
    expect(actual).toMatchObject(expected)
    expect(actual.resources).toBeTypeOf("object")
    expect(Object.keys(actual.resources ?? {}).length).toBeGreaterThan(0)
  }

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    server = await startAppServer({
      PUBLISH_ENABLED: "true",
      GBP_PROFILE_WRITES_ENABLED: "true",
      GBP_PERFORMANCE_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("owner and admin can edit canonical and publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const admin2 = await seedMemberUser(
      admin,
      tenant.organisationId,
      "admin",
      false
    )

    expectCaps((await caps(tenant.cookie, location.locationId)).capabilities, {
      canEditCanonical: true,
      canPublish: true,
    })
    expectCaps((await caps(admin2.cookie, location.locationId)).capabilities, {
      canEditCanonical: true,
      canPublish: true,
    })
  })

  it("viewer can neither edit canonical nor publish", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // can_publish = true on the member row must not leak into a viewer's
    // capabilities: the post routes refuse every viewer action.
    const viewer = await seedMemberUser(
      admin,
      tenant.organisationId,
      "viewer",
      true
    )
    expectCaps((await caps(viewer.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
      canEdit: false,
      canRequestApproval: false,
      canDecideApproval: false,
    })
  })

  it("member with no assignments falls back to session.canPublish, never edits canonical", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const canPub = await seedMemberUser(
      admin,
      tenant.organisationId,
      "member",
      true
    )
    const noPub = await seedMemberUser(
      admin,
      tenant.organisationId,
      "member",
      false
    )
    expectCaps((await caps(canPub.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
      canDecideApproval: true,
    })
    // A drafting member edits and asks for approval but cannot decide one.
    expectCaps((await caps(noPub.cookie, location.locationId)).capabilities, {
      canEditCanonical: false,
      canPublish: false,
      canEdit: true,
      canRequestApproval: true,
      canDecideApproval: false,
    })
  })

  it("member with assignments: only the assigned location with can_publish publishes", async () => {
    const tenant = await createTestTenant(admin, { role: "owner" })
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const assignedPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const assignedNoPublish = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const unassigned = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    // session.canPublish = true, but assignments override it per-location.
    const member = await seedMemberUser(
      admin,
      tenant.organisationId,
      "member",
      true
    )
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedPublish.locationId}, ${member.userId}, true)
    `
    await admin`
      insert into location_member (organisation_id, location_id, user_id, can_publish)
      values (${tenant.organisationId}, ${assignedNoPublish.locationId}, ${member.userId}, false)
    `
    // assigned + can_publish
    expectCaps(
      (await caps(member.cookie, assignedPublish.locationId)).capabilities,
      {
        canEditCanonical: false,
        canPublish: true,
      }
    )
    // assigned, no can_publish
    expectCaps(
      (await caps(member.cookie, assignedNoPublish.locationId)).capabilities,
      {
        canEditCanonical: false,
        canPublish: false,
      }
    )
    // has assignments but not to this location -> no publish
    expectCaps(
      (await caps(member.cookie, unassigned.locationId)).capabilities,
      {
        canEditCanonical: false,
        canPublish: false,
      }
    )
  })

  it.each([
    ["active", false],
    ["expired", false],
    ["revoked", true],
    ["disconnected", true],
    ["inactive account", true],
    ["missing account", true],
    ["open reconnect task", true],
    ["completed reconnect task", false],
    ["transient rate limit", false],
    ["transient provider failure", false],
  ] as const)(
    "projects %s without changing local edit or role authority",
    async (condition, reconnect) => {
      const tenant = await createTestTenant(admin, { role: "owner" })
      organisations.push(tenant.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: tenant.organisationId,
      })
      const location = await seedLinkedLocation(admin, {
        organisationId: tenant.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      if (
        ["active", "expired", "revoked", "disconnected"].includes(condition)
      ) {
        await admin`update google_connection set status = ${condition} where id = ${connection.connectionId}`
      } else if (condition === "inactive account") {
        await admin`update google_account set is_active = false where google_connection_id = ${connection.connectionId}`
      } else if (condition === "missing account") {
        await admin`delete from google_account where google_connection_id = ${connection.connectionId}`
      } else if (condition.includes("reconnect task")) {
        await admin`insert into connection_task (organisation_id, google_connection_id, task_type, status) values (${tenant.organisationId}, ${connection.connectionId}, 'reconnect', ${condition === "open reconnect task" ? "open" : "completed"})`
      } else {
        await admin`update google_connection set last_error_code = ${condition === "transient rate limit" ? "google_rate_limited" : "google_server_error"} where id = ${connection.connectionId}`
      }
      const actual = (await caps(tenant.cookie, location.locationId))
        .capabilities
      expect(actual).toMatchObject({
        canEditCanonical: true,
        canPublish: true,
        canWrite: true,
      })
      expect(actual.resources?.hours).toEqual(
        reconnect
          ? { state: "readOnly", reasonCode: "reconnect_required" }
          : { state: "available" }
      )
      expect(
        actual.resourceActions?.actions["businessInformation.patch"]?.reasonCode
      ).toBe(reconnect ? "reconnect_required" : "eligibility_unknown")
    }
  )

  it("keeps unverified listings publishable and does not expose another tenant's evidence", async () => {
    const tenant = await createTestTenant(admin)
    const other = await createTestTenant(admin)
    organisations.push(tenant.organisationId, other.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await admin`update external_location set verified = false where id = ${location.externalLocationId}`
    const actual = (await caps(tenant.cookie, location.locationId)).capabilities
    expect(actual.canPublish).toBe(true)
    expect(actual.resources?.hours).toEqual({
      state: "available",
      advisoryCode: "verification_unconfirmed",
    })
    const foreign = (await caps(other.cookie, location.locationId)).capabilities
    expect(foreign.resources?.hours).toEqual({
      state: "unavailable",
      reasonCode: "google_location_not_linked",
    })
    await admin`update location_link set is_active = false where location_id = ${location.locationId}`
    expect(
      (await caps(tenant.cookie, location.locationId)).capabilities.resources
        ?.hours
    ).toEqual({
      state: "unavailable",
      reasonCode: "google_location_not_linked",
    })
  })

  it("saves canonical hours locally while a revoked Google login blocks publishing", async () => {
    const tenant = await createTestTenant(admin)
    organisations.push(tenant.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: tenant.organisationId,
    })
    const location = await seedLinkedLocation(admin, {
      organisationId: tenant.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    await admin`update google_connection set status = 'revoked' where id = ${connection.connectionId}`
    const hours = {
      regular: Array.from({ length: 7 }, (_, dayOfWeek) => ({
        dayOfWeek,
        isClosed: true,
        periods: [] as { opensAt: string; closesAt: string }[],
      })),
      special: [],
      moreHours: [],
    }
    await admin`insert into presence_canonical_resource (organisation_id, location_id, resource_type, payload) values (${tenant.organisationId}, ${location.locationId}, 'hours', ${admin.json(hours)})`
    hours.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00" }],
    }
    const response = await fetch(
      `${server.baseUrl}/api/locations/${location.locationId}/hours`,
      {
        method: "PUT",
        headers: { cookie: tenant.cookie, "content-type": "application/json" },
        body: JSON.stringify({ expectedCanonicalRevision: "1", hours }),
      }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const [stored] =
      await admin`select payload from presence_canonical_resource where location_id = ${location.locationId} and resource_type = 'hours'`
    expect(stored?.payload.regular[1]).toEqual(hours.regular[1])
    expect(
      (await caps(tenant.cookie, location.locationId)).capabilities.resources
        ?.hours?.reasonCode
    ).toBe("reconnect_required")
  })
})
