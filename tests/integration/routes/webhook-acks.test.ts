import { randomUUID } from "node:crypto"

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

describeDatabase("Pub/Sub acknowledgment matrix", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  let owner: Awaited<ReturnType<typeof createTestTenant>>
  let viewer: Awaited<ReturnType<typeof createTestTenant>>
  let otherOwner: Awaited<ReturnType<typeof createTestTenant>>
  let externalLocationId: string
  let googleAccountName: string
  let googleLocationName: string

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    owner = await createTestTenant(admin)
    viewer = await createTestTenant(admin, { role: "viewer" })
    otherOwner = await createTestTenant(admin)
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
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "2500",
      WEBHOOKS_ENABLED: "true",
      GOOGLE_PUBSUB_VERIFICATION_TOKEN: verificationToken,
      GOOGLE_PUBSUB_AUDIENCE: "",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, [
      owner.organisationId,
      viewer.organisationId,
      otherOwner.organisationId,
    ])
    await admin.end()
  })

  function envelope(
    payload: unknown,
    messageId = randomUUID()
  ): Record<string, unknown> {
    return {
      ...fixture,
      message: {
        ...fixture.message,
        messageId,
        data: Buffer.from(JSON.stringify(payload)).toString("base64"),
      },
    }
  }

  function linkedPayload() {
    return {
      location: `${googleAccountName}/${googleLocationName}`,
      review: `${googleAccountName}/${googleLocationName}/reviews/r-acks`,
      type: "NEW_REVIEW",
    }
  }

  function post(body: unknown, token: string | null = verificationToken) {
    return fetch(`${server.baseUrl}/api/webhooks/google/pubsub`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { "x-goog-pubsub-token": token }),
      },
      body: JSON.stringify(body),
    })
  }

  function countEvents(messageId: string) {
    return admin<{ count: number }[]>`
      select count(*)::int as count
      from processed_webhook_event
      where external_event_id = ${messageId}
    `.then(([row]) => row.count)
  }

  function healthyGoogle() {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
    }))
  }

  it("rejects an unauthenticated delivery without recording anything", async () => {
    const messageId = randomUUID()
    const anonymous = await post(envelope(linkedPayload(), messageId), null)
    expect(anonymous.status).toBe(401)
    expect(await anonymous.json()).toMatchObject({
      error: "invalid_pubsub_token",
    })
    const wrongToken = await post(
      envelope(linkedPayload(), messageId),
      "not-the-configured-push-token-abcd!!"
    )
    expect(wrongToken.status).toBe(401)
    expect(await countEvents(messageId)).toBe(0)
  })

  it("acknowledges non-JSON message data as discarded", async () => {
    const response = await post({
      ...fixture,
      message: { ...fixture.message, data: "%%%" },
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "discarded" })
  })

  it("acknowledges an invalid envelope as discarded", async () => {
    const response = await post({})
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "discarded" })
  })

  it("acknowledges an unresolvable notification as discarded", async () => {
    const response = await post(envelope({}))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "discarded" })
    expect(`${server.stdout}\n${server.stderr}`).toContain(
      "nabapresence.webhook.discarded"
    )
  })

  it("acknowledges an unknown location as ignored", async () => {
    const response = await post(
      envelope({
        location: "accounts/unknown/locations/nope",
        type: "NEW_REVIEW",
      })
    )
    expect(response.status).toBe(200)
    // Identical to the routed-but-unlinked body: a per-location difference
    // would let an unauthenticated caller enumerate managed locations.
    expect(await response.json()).toEqual({ status: "ignored" })
  })

  it("marks a linked successful notification processed", async () => {
    healthyGoogle()
    const messageId = randomUUID()
    const response = await post(envelope(linkedPayload(), messageId))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ status: "processed" })
    const [event] = await admin<{ status: string }[]>`
      select status
      from processed_webhook_event
      where external_event_id = ${messageId}
    `
    expect(event.status).toBe("processed")
  })

  it("durably schedules a linked provider failure", async () => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 500,
      json: { error: { status: "INTERNAL" } },
    }))
    const messageId = randomUUID()
    const response = await post(envelope(linkedPayload(), messageId))
    expect(response.status, await response.clone().text()).toBe(200)
    expect(await response.json()).toMatchObject({ status: "failed" })
    const [event] = await admin<
      {
        status: string
        retry_count: number
        next_attempt_at: Date | null
      }[]
    >`
      select status, retry_count, next_attempt_at
      from processed_webhook_event
      where external_event_id = ${messageId}
    `
    expect(event).toMatchObject({
      status: "failed",
      retry_count: 0,
    })
    expect(event.next_attempt_at).toBeInstanceOf(Date)
  }, 15_000)

  it("returns duplicate for an already processed message", async () => {
    healthyGoogle()
    const messageId = randomUUID()
    const first = await post(envelope(linkedPayload(), messageId))
    expect(first.status).toBe(200)
    const duplicate = await post(envelope(linkedPayload(), messageId))
    expect(duplicate.status).toBe(200)
    expect(await duplicate.json()).toEqual({ status: "duplicate" })
  })

  it("acknowledges a redelivery arriving mid-sync without syncing twice", async () => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/reviews" }, () => ({
      status: 200,
      json: { reviews: [] },
      delayMs: 1_500,
    }))
    const messageId = randomUUID()
    const inFlight = post(envelope(linkedPayload(), messageId))
    // Long enough for the claim transaction to commit and the Google call to
    // start; Pub/Sub redelivers on its own ack deadline, not on ours.
    await new Promise((resolve) => setTimeout(resolve, 500))
    const redelivery = await post(envelope(linkedPayload(), messageId))
    expect(redelivery.status, await redelivery.clone().text()).toBe(200)
    expect(await redelivery.json()).toEqual({ status: "in_progress" })

    const first = await inFlight
    expect(first.status, await first.clone().text()).toBe(200)
    expect(await first.json()).toMatchObject({ status: "processed" })
    expect(
      stub.calls.filter(
        (call) => call.method === "GET" && call.path.includes("/reviews")
      )
    ).toHaveLength(1)
    const [event] = await admin<{ status: string }[]>`
      select status
      from processed_webhook_event
      where external_event_id = ${messageId}
    `
    expect(event.status).toBe("processed")
  }, 20_000)

  it("lists only tenant-scoped failed webhook events for owners", async () => {
    const ownEventId = randomUUID()
    const otherEventId = randomUUID()
    await admin`
      insert into processed_webhook_event (
        id,
        organisation_id,
        external_location_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        status,
        next_attempt_at
      )
      values (
        ${ownEventId},
        ${owner.organisationId},
        ${externalLocationId},
        'google_pubsub',
        ${randomUUID()},
        'NEW_REVIEW',
        ${randomUUID()},
        'failed',
        now()
      )
    `
    await admin`
      insert into processed_webhook_event (
        id,
        organisation_id,
        provider,
        external_event_id,
        event_type,
        payload_hash,
        status,
        next_attempt_at
      )
      values (
        ${otherEventId},
        ${otherOwner.organisationId},
        'google_pubsub',
        ${randomUUID()},
        'NEW_REVIEW',
        ${randomUUID()},
        'failed',
        now()
      )
    `

    const response = await fetch(
      `${server.baseUrl}/api/webhooks/google/pubsub/failures`,
      { headers: { cookie: owner.cookie } }
    )
    expect(response.status, await response.clone().text()).toBe(200)
    const body = (await response.json()) as {
      items: Array<{ id: string }>
    }
    expect(body.items.some((item) => item.id === ownEventId)).toBe(true)
    expect(body.items.every((item) => item.id !== otherEventId)).toBe(true)

    const forbidden = await fetch(
      `${server.baseUrl}/api/webhooks/google/pubsub/failures`,
      { headers: { cookie: viewer.cookie } }
    )
    expect(forbidden.status).toBe(403)
    const unauthenticated = await fetch(
      `${server.baseUrl}/api/webhooks/google/pubsub/failures`
    )
    expect(unauthenticated.status).toBe(401)
  })
})
