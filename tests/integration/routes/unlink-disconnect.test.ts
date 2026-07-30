import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import fixture from "../../fixtures/pubsub/new-review.json"
import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const verificationToken = "harness-pubsub-token-32-characters!!"

describeDatabase("unlink and disconnect routing cleanup", () => {
  let admin: ReturnType<typeof postgres>
  let runtime: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let viewer: Awaited<ReturnType<typeof createTestTenant>>
  let tenantB: Awaited<ReturnType<typeof createTestTenant>>
  let unlinkLocationId: string
  let unlinkGoogleAccountName: string
  let unlinkGoogleLocationName: string
  let disconnectConnectionId: string
  let disconnectLocationId: string
  let reclaimLocationA: string
  let reclaimLocationB: string
  let reclaimGoogleLocationName: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    owner = await createTestTenant(admin)
    viewer = await createTestTenant(admin, { role: "viewer" })
    tenantB = await createTestTenant(admin)

    const unlinkConnection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    unlinkGoogleAccountName = unlinkConnection.googleAccountName
    const unlinkLocation = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: unlinkConnection.connectionId,
      googleAccountName: unlinkConnection.googleAccountName,
    })
    unlinkLocationId = unlinkLocation.externalLocationId

    const disconnectConnection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    disconnectConnectionId = disconnectConnection.connectionId
    const disconnectLocation = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: disconnectConnection.connectionId,
      googleAccountName: disconnectConnection.googleAccountName,
    })
    disconnectLocationId = disconnectLocation.externalLocationId

    const reclaimConnectionA = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const reclaimA = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: reclaimConnectionA.connectionId,
      googleAccountName: reclaimConnectionA.googleAccountName,
    })
    reclaimLocationA = reclaimA.externalLocationId
    const [reclaimExternalA] = await admin<
      { google_location_name: string }[]
    >`
      select google_location_name
      from external_location
      where id = ${reclaimLocationA}
    `
    reclaimGoogleLocationName = reclaimExternalA.google_location_name

    const reclaimConnectionB = await seedGoogleConnection(admin, {
      organisationId: tenantB.organisationId,
    })
    reclaimLocationB = randomUUID()
    await admin`
      insert into external_location (
        id,
        organisation_id,
        google_connection_id,
        google_account_name,
        google_location_name,
        title,
        verified
      )
      values (
        ${reclaimLocationB},
        ${tenantB.organisationId},
        ${reclaimConnectionB.connectionId},
        ${reclaimConnectionB.googleAccountName},
        ${reclaimGoogleLocationName},
        'Reclaimed location',
        true
      )
    `

    const routedLocations = await admin<
      {
        id: string
        google_location_name: string
      }[]
    >`
      select id::text as id, google_location_name
      from external_location
      where id in (
        ${unlinkLocationId},
        ${disconnectLocationId},
        ${reclaimLocationA}
      )
    `
    await admin`
      insert into webhook_route (
        google_location_name,
        organisation_id,
        external_location_id
      )
      select
        google_location_name,
        ${owner.organisationId},
        id
      from external_location
      where id in (
        ${unlinkLocationId},
        ${disconnectLocationId},
        ${reclaimLocationA}
      )
    `
    unlinkGoogleLocationName = routedLocations.find(
      (location) => location.id === unlinkLocationId
    )!.google_location_name
    await admin`
      insert into sync_checkpoint (
        organisation_id,
        external_location_id,
        sync_type,
        status,
        next_attempt_at
      )
      values (
        ${owner.organisationId},
        ${unlinkLocationId},
        'backfill',
        'pending',
        now()
      )
    `

    server = await startAppServer({
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: verificationToken,
      GOOGLE_PUBSUB_AUDIENCE: "",
    })
  })

  afterAll(async () => {
    await server.stop()
    await destroyTenants(admin, [
      owner.organisationId,
      viewer.organisationId,
      tenantB.organisationId,
    ])
    await Promise.all([admin.end(), runtime.end()])
  })

  function unlink(externalLocationId: string, cookie = owner.cookie) {
    return fetch(
      `${server.baseUrl}/api/location-links?externalLocationId=${externalLocationId}`,
      {
        method: "DELETE",
        headers: { cookie },
      }
    )
  }

  it("unlink deactivates the link and removes webhook routing", async () => {
    const response = await unlink(unlinkLocationId)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toEqual({ unlinked: true })

    const [link] = await admin<{ is_active: boolean }[]>`
      select is_active
      from location_link
      where external_location_id = ${unlinkLocationId}
    `
    expect(link.is_active).toBe(false)
    expect(
      await admin`
        select 1
        from webhook_route
        where external_location_id = ${unlinkLocationId}
      `
    ).toEqual([])
    const [checkpoint] = await admin<{ status: string }[]>`
      select status
      from sync_checkpoint
      where external_location_id = ${unlinkLocationId}
    `
    expect(checkpoint.status).toBe("cancelled")

    const webhook = await fetch(
      `${server.baseUrl}/api/webhooks/google/pubsub`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-pubsub-token": verificationToken,
        },
        body: JSON.stringify({
          ...fixture,
          message: {
            ...fixture.message,
            messageId: randomUUID(),
            data: Buffer.from(
              JSON.stringify({
                location: `${unlinkGoogleAccountName}/${unlinkGoogleLocationName}`,
                type: "NEW_REVIEW",
              })
            ).toString("base64"),
          },
        }),
      }
    )
    expect(webhook.status).toBe(200)
    expect(await webhook.json()).toMatchObject({ status: "ignored" })
  })

  it("disconnect removes routing for every location of the connection", async () => {
    const response = await fetch(
      `${server.baseUrl}/api/google/connections/${disconnectConnectionId}/disconnect`,
      {
        method: "POST",
        headers: { cookie: owner.cookie },
      }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    expect(
      await admin`
        select 1
        from webhook_route
        where external_location_id = ${disconnectLocationId}
      `
    ).toEqual([])
    const [link] = await admin<{ is_active: boolean }[]>`
      select is_active
      from location_link
      where external_location_id = ${disconnectLocationId}
    `
    expect(link.is_active).toBe(false)
  })

  it("re-discovery after another tenant's unlink can claim the freed route", async () => {
    const response = await unlink(reclaimLocationA)
    expect(response.status, await response.clone().text()).toBe(200)

    await runtime.begin(async (sql) => {
      await sql`
        select set_config(
          'app.organisation_id',
          ${tenantB.organisationId},
          true
        )
      `
      await sql`
        insert into webhook_route (
          google_location_name,
          organisation_id,
          external_location_id
        )
        values (
          ${reclaimGoogleLocationName},
          ${tenantB.organisationId},
          ${reclaimLocationB}
        )
      `
    })
    const [route] = await admin<{ organisation_id: string }[]>`
      select organisation_id::text as organisation_id
      from webhook_route
      where google_location_name = ${reclaimGoogleLocationName}
    `
    expect(route.organisation_id).toBe(tenantB.organisationId)
  })

  it("requires an owner or admin to unlink", async () => {
    const forbidden = await unlink(disconnectLocationId, viewer.cookie)
    expect(forbidden.status).toBe(403)
    const unauthenticated = await fetch(
      `${server.baseUrl}/api/location-links?externalLocationId=${disconnectLocationId}`,
      { method: "DELETE" }
    )
    expect(unauthenticated.status).toBe(401)
  })
})
