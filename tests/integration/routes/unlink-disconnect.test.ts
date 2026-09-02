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

type SeededAttempt = { reviewId: string; replyId: string; attemptId: string }

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
  let strandedAttempt: SeededAttempt
  let inFlightAttempt: SeededAttempt
  let reclaimLocationA: string
  let reclaimLocationB: string
  let reclaimGoogleLocationName: string
  let relinkExternalA: string
  let relinkExternalB: string

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
    // Two queued publishes on the connection about to disappear: an
    // `ambiguous` one nothing can ever read back again, and a `started` one
    // whose write may already have landed at Google.
    strandedAttempt = await seedPublishAttempt(
      disconnectConnection.connectionId,
      disconnectConnection.googleAccountName,
      "ambiguous"
    )
    inFlightAttempt = await seedPublishAttempt(
      disconnectConnection.connectionId,
      disconnectConnection.googleAccountName,
      "started"
    )

    const relinkConnection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    ;[relinkExternalA, relinkExternalB] = await Promise.all(
      ["a", "b"].map((suffix) =>
        seedExternalLocation(
          relinkConnection.connectionId,
          relinkConnection.googleAccountName,
          suffix
        )
      )
    )

    const reclaimConnectionA = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const reclaimA = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: reclaimConnectionA.connectionId,
      googleAccountName: reclaimConnectionA.googleAccountName,
    })
    reclaimLocationA = reclaimA.externalLocationId
    const [reclaimExternalA] = await admin<{ google_location_name: string }[]>`
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

  /**
   * A review on `connectionId` with an approved reply parked at
   * `attemptStatus`. The workflow is walked one legal step at a time because
   * enforce_review_workflow_transition rejects new -> publish_requested.
   */
  async function seedPublishAttempt(
    connectionId: string,
    googleAccountName: string,
    attemptStatus: "ambiguous" | "started"
  ): Promise<SeededAttempt> {
    const seeded = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId,
      googleAccountName,
    })
    const replyId = randomUUID()
    const attemptId = randomUUID()
    await admin`
      insert into review_reply (
        id,
        organisation_id,
        review_id,
        current_body,
        publish_status
      )
      values (
        ${replyId},
        ${owner.organisationId},
        ${seeded.reviewId},
        'Queued reply awaiting Google',
        'accepted'
      )
    `
    for (const status of ["drafted", "verified", "publish_requested"]) {
      await admin`
        update review set workflow_status = ${status} where id = ${seeded.reviewId}
      `
    }
    await admin`
      insert into publish_attempt (
        id,
        organisation_id,
        review_reply_id,
        idempotency_key,
        request_body_hash,
        status,
        attempt_no,
        next_attempt_at
      )
      values (
        ${attemptId},
        ${owner.organisationId},
        ${replyId},
        ${`disconnect-key-${attemptId}`},
        ${`disconnect-hash-${attemptId}`},
        ${attemptStatus},
        1,
        now()
      )
    `
    return { reviewId: seeded.reviewId, replyId, attemptId }
  }

  /** An unlinked Google location; both share a title on purpose. */
  async function seedExternalLocation(
    connectionId: string,
    googleAccountName: string,
    suffix: string
  ): Promise<string> {
    const id = randomUUID()
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
        ${id},
        ${owner.organisationId},
        ${connectionId},
        ${googleAccountName},
        ${`locations/relink-${suffix}-${id}`},
        'Relink duplicate inn',
        true
      )
    `
    return id
  }

  function link(externalLocationId: string) {
    return fetch(`${server.baseUrl}/api/location-links`, {
      method: "POST",
      headers: { cookie: owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ externalLocationId }),
    })
  }

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
    // Revocation is phase one and commits before any Google call, so a
    // provider outage can never leave live tokens on a "disconnected" row.
    const [connection] = await admin<
      {
        status: string
        accessToken: Buffer | null
        refreshToken: Buffer | null
        purgeDueAt: Date | null
      }[]
    >`
      select
        status,
        access_token_ciphertext as "accessToken",
        refresh_token_ciphertext as "refreshToken",
        purge_due_at as "purgeDueAt"
      from google_connection
      where id = ${disconnectConnectionId}
    `
    expect(connection.status).toBe("disconnected")
    expect(connection.accessToken).toBeNull()
    expect(connection.refreshToken).toBeNull()
    expect(connection.purgeDueAt).not.toBeNull()
  })

  it("disconnect settles the attempts it strands and leaves in-flight ones alone", async () => {
    const [stranded] = await admin<
      {
        status: string
        errorCode: string | null
        nextAttemptAt: Date | null
      }[]
    >`
      select
        status,
        provider_error_code as "errorCode",
        next_attempt_at as "nextAttemptAt"
      from publish_attempt
      where id = ${strandedAttempt.attemptId}
    `
    expect(stranded).toMatchObject({
      status: "failed",
      errorCode: "connection_disconnected",
    })
    expect(stranded.nextAttemptAt).toBeNull()
    const [event] = await admin<{ eventType: string }[]>`
      select event_type as "eventType"
      from publish_attempt_event
      where publish_attempt_id = ${strandedAttempt.attemptId}
    `
    expect(event.eventType).toBe("completed")
    const [reply] = await admin<{ publishStatus: string }[]>`
      select publish_status as "publishStatus"
      from review_reply
      where id = ${strandedAttempt.replyId}
    `
    expect(reply.publishStatus).toBe("failed")
    const [review] = await admin<{ workflowStatus: string }[]>`
      select workflow_status as "workflowStatus"
      from review
      where id = ${strandedAttempt.reviewId}
    `
    expect(review.workflowStatus).toBe("failed")

    // A `started` attempt may already have written to Google; only
    // reclaim_expired_jobs may move it, and never to a terminal state here.
    const [inFlight] = await admin<{ status: string }[]>`
      select status
      from publish_attempt
      where id = ${inFlightAttempt.attemptId}
    `
    expect(inFlight.status).toBe("started")
  })

  it("relinks an internal location that a previous unlink left behind", async () => {
    const first = await link(relinkExternalA)
    expect(first.status, await first.clone().text()).toBe(201)
    const created = (await first.json()) as { link: { locationId: string } }

    expect((await unlink(relinkExternalA)).status).toBe(200)

    // B has the same title, so it resolves to the same internal location -
    // whose one-to-one slot the deactivated A link still occupies.
    const second = await link(relinkExternalB)
    expect(second.status, await second.clone().text()).toBe(201)
    const relinked = (await second.json()) as { link: { locationId: string } }
    expect(relinked.link.locationId).toBe(created.link.locationId)
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
