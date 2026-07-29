import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import fixture from "../../fixtures/pubsub/new-review.json"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const run = process.env.RUN_DB_TESTS === "true"
const describeDatabase = run ? describe : describe.skip
const verificationToken = "harness-pubsub-token-32-characters!!"

describeDatabase("documented Pub/Sub payload route", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let externalLocationId: string
  let googleAccountName: string
  let googleLocationName: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    googleAccountName = connection.googleAccountName
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName,
    })
    externalLocationId = linked.externalLocationId
    const [location] = await admin<{ google_location_name: string }[]>`
      select google_location_name
      from external_location
      where id = ${externalLocationId}
    `
    googleLocationName = location.google_location_name
    await admin`
      insert into webhook_route (
        google_location_name,
        organisation_id,
        external_location_id
      )
      values (
        ${googleLocationName},
        ${owner.organisationId},
        ${externalLocationId}
      )
    `
    stub.respond(
      { method: "GET", pathIncludes: "/reviews" },
      () => ({ status: 200, json: { reviews: [] } })
    )
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: verificationToken,
      GOOGLE_PUBSUB_AUDIENCE: "",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [owner.organisationId])
    await admin.end()
  })

  it("processes the documented camelCase notification envelope", async () => {
    const payload = {
      location: `${googleAccountName}/${googleLocationName}`,
      review: `${googleAccountName}/${googleLocationName}/reviews/r-777`,
      type: "NEW_REVIEW",
    }
    const envelope = {
      ...fixture,
      message: {
        ...fixture.message,
        data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    }

    const response = await fetch(
      `${server.baseUrl}/api/webhooks/google/pubsub`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-goog-pubsub-token": verificationToken,
        },
        body: JSON.stringify(envelope),
      }
    )

    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ status: "processed" })
    expect(
      stub.calls.filter(
        (call) =>
          call.method === "GET" && call.path.includes("/reviews")
      )
    ).toHaveLength(1)
    const [event] = await admin<{ event_type: string; status: string }[]>`
      select event_type, status
      from processed_webhook_event
      where organisation_id = ${owner.organisationId}
        and external_location_id = ${externalLocationId}
    `
    expect(event).toEqual({
      event_type: "NEW_REVIEW",
      status: "processed",
    })
  })
})
