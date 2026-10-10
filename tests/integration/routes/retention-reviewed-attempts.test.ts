import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { startAppServer } from "../helpers/app-server"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedLocation,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

// A reviewed attempt is created after its review, so the review's 180-day
// retention ends first. Purging must wait for the attempt instead of failing.
describeDatabase("retention of reviewed Place Action attempts", () => {
  let admin: ReturnType<typeof postgres>
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, {
      max: 1,
      prepare: false,
    })
    server = await startAppServer()
  })
  afterAll(async () => {
    await server?.stop()
    await destroyTenants(admin, organisations)
    await admin?.end()
  })

  async function runRetention() {
    const failures: Array<{ organisationId: string; errorCode: string }> = []
    let cursor: string | null = null
    do {
      const query = new URLSearchParams({ batch_size: "100" })
      if (cursor) query.set("cursor", cursor)
      const response = await fetch(
        `${server.baseUrl}/api/cron/retention?${query}`,
        {
          method: "POST",
          headers: { authorization: "Bearer route-harness-cron-secret" },
        }
      )
      expect(response.status).toBe(200)
      const payload = (await response.json()) as {
        failures: typeof failures
        nextCursor: string | null
      }
      failures.push(...payload.failures)
      cursor = payload.nextCursor
    } while (cursor)
    return failures
  }

  async function seedReviewedAttempt() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedLocation(admin, {
      organisationId: owner.organisationId,
      ...connection,
    })
    const [account] = await admin<
      { id: string }[]
    >`select id from google_account where google_connection_id = ${connection.connectionId} limit 1`
    const request = {
      operation: "create",
      payload: {
        uri: "https://shop.example.test/retained",
        placeActionType: "SHOP_ONLINE",
        isPreferred: false,
      },
    }
    const payload = {
      request,
      connectionId: connection.connectionId,
      credentialGeneration: 0,
      observedAt: new Date().toISOString(),
    }
    const [review] = await admin<{ id: string }[]>`
      insert into gbp_change_set (organisation_id, location_id, google_account_id, connection_id, target_resource_name, resource_type, requested_by,
        payload, payload_hash, update_mask, baseline, baseline_hash, require_two_person_approval)
      values (${owner.organisationId}, ${linked.locationId}, ${account.id}, ${connection.connectionId}, ${linked.googleLocationName}, 'place_action', ${owner.userId},
        ${admin.json(payload)}, ${"a".repeat(64)}, array[]::text[], '{}'::jsonb, ${"b".repeat(64)}, false)
      returning id`
    const [attempt] = await admin<{ id: string }[]>`
      insert into place_action_mutation (organisation_id, location_id, external_location_id, actor_user_id, google_account_id, operation, status,
        idempotency_key, requested_payload, change_set_id, execution_state, confirmation_state)
      values (${owner.organisationId}, ${linked.locationId}, ${linked.externalLocationId}, ${owner.userId}, ${account.id}, 'create', 'succeeded',
        ${`place_action:${review.id}`}, ${admin.json(payload)}, ${review.id}, 'accepted', 'confirmed')
      returning id`
    return {
      organisationId: owner.organisationId,
      reviewId: review.id,
      attemptId: attempt.id,
    }
  }

  it("keeps an expired review while its attempt is retained, then purges both without failing the run", async () => {
    const seeded = await seedReviewedAttempt()
    await admin`update gbp_change_set set expires_at = now() - interval '1 day' where id = ${seeded.reviewId}`
    const first = await runRetention()
    expect(
      first.filter(
        (failure) => failure.organisationId === seeded.organisationId
      )
    ).toEqual([])
    expect(
      await admin`select id from gbp_change_set where id = ${seeded.reviewId}`
    ).toHaveLength(1)
    expect(
      await admin`select id from place_action_mutation where id = ${seeded.attemptId}`
    ).toHaveLength(1)
    await admin`update place_action_mutation set expires_at = now() - interval '1 minute' where id = ${seeded.attemptId}`
    const second = await runRetention()
    expect(
      second.filter(
        (failure) => failure.organisationId === seeded.organisationId
      )
    ).toEqual([])
    expect(
      await admin`select id from place_action_mutation where id = ${seeded.attemptId}`
    ).toHaveLength(0)
    expect(
      await admin`select id from gbp_change_set where id = ${seeded.reviewId}`
    ).toHaveLength(0)
  })
})
