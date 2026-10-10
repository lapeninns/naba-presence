import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { hashFoodMenus } from "@/lib/domain/food-menus"

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

/**
 * The `mutation_recover` job kind end to end (0073 claim arm, the runner,
 * lib/server/mutation-recovery.ts and the food menus and posts adapters): an
 * uncertain receipt is read back and settled, and never re-sent.
 */
describeDatabase("uncertain listing write recovery", () => {
  let admin: ReturnType<typeof postgres>
  let stub: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  const MENUS = [{ labels: [{ displayName: "Lunch" }], sections: [] }]

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    stub = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: stub.baseUrl,
      GOOGLE_TIMEOUT_MS: "2500",
      GOOGLE_MUTATION_TIMEOUT_MS: "2500",
    })
  })

  afterAll(async () => {
    await server.stop()
    await stub.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function runTick() {
    const response = await fetch(`${server.baseUrl}/api/jobs/run`, {
      method: "POST",
      headers: {
        authorization: "Bearer route-harness-cron-secret",
        "content-type": "application/json",
      },
      body: "{}",
    })
    expect(response.status, await response.clone().text()).toBe(200)
  }

  /** An uncertain food menus receipt over an `ambiguous` attempt. */
  async function seedUncertainMenus(options: { surface?: string } = {}) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, {
      organisationId: owner.organisationId,
    })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })
    const attemptId = randomUUID()
    const operationId = randomUUID()
    await admin`
      insert into food_menus_sync_attempt (
        id, organisation_id, location_id, external_location_id,
        actor_user_id, status, idempotency_key, expected_canonical_revision,
        expected_canonical_hash, expected_google_hash, intended_payload,
        last_error_code, started_at
      ) values (
        ${attemptId}, ${owner.organisationId}, ${linked.locationId},
        ${linked.externalLocationId}, ${owner.userId}, 'ambiguous',
        ${`key-${attemptId}`}, '1', ${hashFoodMenus(MENUS)}, ${"b".repeat(64)},
        ${admin.json(MENUS)}, 'attempt_interrupted', now() - interval '1 day'
      )
    `
    await admin`
      insert into mutation_operation (
        id, organisation_id, intent_id, actor_user_id, surface, action,
        location_id, payload_hash, google_connection_id, attempt_table,
        attempt_id, state, next_recovery_at
      ) values (
        ${operationId}, ${owner.organisationId}, ${randomUUID()},
        ${owner.userId}, ${options.surface ?? "food_menus"}, 'publish',
        ${linked.locationId}, ${"c".repeat(64)}, ${connection.connectionId},
        'food_menus_sync_attempt', ${attemptId}, 'uncertain',
        now() - interval '1 second'
      )
    `
    return { owner, attemptId, operationId }
  }

  async function state(operationId: string, attemptId: string) {
    const [row] = await admin<
      {
        state: string
        errorCode: string | null
        nextRecoveryAt: Date | null
        leaseExpiresAt: Date | null
        attemptStatus: string
      }[]
    >`
      select
        o.state,
        o.error_code as "errorCode",
        o.next_recovery_at as "nextRecoveryAt",
        o.lease_expires_at as "leaseExpiresAt",
        a.status as "attemptStatus"
      from mutation_operation o
      join food_menus_sync_attempt a on a.id = o.attempt_id
      where o.id = ${operationId} and a.id = ${attemptId}
    `
    return row
  }

  it("confirms a replacement that landed and sends nothing", async () => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({
      status: 200,
      json: { name: "foodMenus", menus: MENUS },
    }))
    const { operationId, attemptId } = await seedUncertainMenus()
    await runTick()
    expect(await state(operationId, attemptId)).toMatchObject({
      state: "confirmed_applied",
      errorCode: null,
      nextRecoveryAt: null,
      leaseExpiresAt: null,
      attemptStatus: "succeeded",
    })
    expect(stub.calls.filter((call) => call.method === "PATCH")).toEqual([])
  }, 60_000)

  it("fails a replacement Google does not hold, still without a re-send", async () => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({
      status: 200,
      json: { name: "foodMenus", menus: [] },
    }))
    const { operationId, attemptId } = await seedUncertainMenus()
    await runTick()
    expect(await state(operationId, attemptId)).toMatchObject({
      state: "failed",
      errorCode: "google_readback_mismatch",
      attemptStatus: "failed",
    })
    expect(stub.calls.filter((call) => call.method === "PATCH")).toEqual([])
  }, 60_000)

  it("backs off an unreadable Google and counts the readback", async () => {
    stub.reset()
    stub.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({
      status: 503,
      json: { error: { status: "UNAVAILABLE" } },
    }))
    const { operationId, attemptId } = await seedUncertainMenus()
    await runTick()
    const after = await state(operationId, attemptId)
    expect(after.state).toBe("uncertain")
    expect(after.attemptStatus).toBe("ambiguous")
    expect(after.nextRecoveryAt!.getTime()).toBeGreaterThan(Date.now())
    const [{ recoveryAttempts }] = await admin<{ recoveryAttempts: number }[]>`
      select recovery_attempts as "recoveryAttempts"
      from mutation_operation where id = ${operationId}
    `
    expect(recoveryAttempts).toBe(1)
  }, 60_000)

  it("stops a receipt no adapter can read and notifies the owners", async () => {
    stub.reset()
    const { owner, operationId, attemptId } = await seedUncertainMenus({
      surface: "not_a_surface",
    })
    await runTick()
    expect(await state(operationId, attemptId)).toMatchObject({
      state: "uncertain",
      errorCode: "recovery_unsupported",
      nextRecoveryAt: null,
      attemptStatus: "ambiguous",
    })
    const deliveries = await admin<{ recipient: string }[]>`
      select d.recipient_user_id::text as recipient
      from notification_incident i
      join notification_delivery d on d.incident_id = i.id
      where i.organisation_id = ${owner.organisationId}
        and i.kind = 'mutation_unconfirmed'
        and i.subject_id = ${operationId}
    `
    expect(deliveries.map((row) => row.recipient)).toEqual([owner.userId])
    expect(
      stub.calls.filter((call) => call.path.includes("/foodMenus"))
    ).toEqual([])
  }, 60_000)

  describe("posts", () => {
    const SENT = {
      topicType: "STANDARD",
      languageCode: "en-GB",
      summary: "Quiz night every Thursday",
    }
    const NEWER = "Quiz night moves to Wednesday"

    /**
     * Attempt A, an uncertain UPDATE of a named post, under its receipt.
     * `post` is the row as it stands when recovery reads A back; `later`
     * adds the newer publish B that has run since.
     */
    async function seedUncertainPostUpdate(options: {
      post: { status: string; summary: string; lastErrorCode?: string }
      later?: boolean
    }) {
      const owner = await createTestTenant(admin)
      organisations.push(owner.organisationId)
      const connection = await seedGoogleConnection(admin, {
        organisationId: owner.organisationId,
      })
      const linked = await seedLinkedReview(admin, {
        organisationId: owner.organisationId,
        connectionId: connection.connectionId,
        googleAccountName: connection.googleAccountName,
      })
      const postId = randomUUID()
      const attemptId = randomUUID()
      const operationId = randomUUID()
      const googlePostName = `${linked.googleLocationName}/localPosts/${postId}`
      await admin`
        insert into gbp_local_post (
          id, organisation_id, location_id, external_location_id,
          topic_type, language_code, summary, status, google_post_name,
          last_error_code, created_by
        ) values (
          ${postId}, ${owner.organisationId}, ${linked.locationId},
          ${linked.externalLocationId}, 'STANDARD', 'en-GB',
          ${options.post.summary}, ${options.post.status}, ${googlePostName},
          ${options.post.lastErrorCode ?? null}, ${owner.userId}
        )
      `
      await admin`
        insert into gbp_local_post_attempt (
          id, organisation_id, post_id, actor_user_id, operation, status,
          idempotency_key, intended_payload, provider_error_code, started_at
        ) values (
          ${attemptId}, ${owner.organisationId}, ${postId}, ${owner.userId},
          'update', 'ambiguous', ${`key-${attemptId}`}, ${admin.json(SENT)},
          'google_post_update_unconfirmed', now() - interval '1 day'
        )
      `
      if (options.later) {
        await admin`
          insert into gbp_local_post_attempt (
            organisation_id, post_id, actor_user_id, operation, status,
            idempotency_key, intended_payload, started_at, finished_at
          ) values (
            ${owner.organisationId}, ${postId}, ${owner.userId}, 'update',
            'succeeded', ${`key-later-${attemptId}`},
            ${admin.json({ ...SENT, summary: NEWER })},
            now() - interval '1 hour', now() - interval '1 hour'
          )
        `
      }
      await admin`
        insert into mutation_operation (
          id, organisation_id, intent_id, actor_user_id, surface, action,
          location_id, payload_hash, google_connection_id, attempt_table,
          attempt_id, state, next_recovery_at
        ) values (
          ${operationId}, ${owner.organisationId}, ${randomUUID()},
          ${owner.userId}, 'local_post', 'update', ${linked.locationId},
          ${"c".repeat(64)}, ${connection.connectionId},
          'gbp_local_post_attempt', ${attemptId}, 'uncertain',
          now() - interval '1 second'
        )
      `
      return { postId, attemptId, operationId, googlePostName }
    }

    function googleHolds(name: string, summary: string) {
      stub.reset()
      stub.respond({ method: "GET", pathIncludes: "/localPosts/" }, () => ({
        status: 200,
        json: { name, ...SENT, summary, state: "LIVE" },
      }))
    }

    async function postState(
      postId: string,
      attemptId: string,
      operationId: string
    ) {
      const [row] = await admin<
        {
          status: string
          summary: string
          lastErrorCode: string | null
          attemptStatus: string
          state: string
        }[]
      >`
        select p.status, p.summary, p.last_error_code as "lastErrorCode",
          a.status as "attemptStatus", o.state
        from gbp_local_post p
        join gbp_local_post_attempt a on a.post_id = p.id and a.id = ${attemptId}
        join mutation_operation o on o.id = ${operationId}
        where p.id = ${postId}
      `
      return row
    }

    it("leaves a newer published revision alone when the old update did not land", async () => {
      const seeded = await seedUncertainPostUpdate({
        post: { status: "published", summary: NEWER },
        later: true,
      })
      googleHolds(seeded.googlePostName, NEWER)
      await runTick()
      expect(
        await postState(seeded.postId, seeded.attemptId, seeded.operationId)
      ).toMatchObject({
        status: "published",
        summary: NEWER,
        lastErrorCode: null,
        attemptStatus: "failed",
        state: "failed",
      })
      expect(stub.calls.filter((call) => call.method !== "GET")).toEqual([])
    }, 60_000)

    it("keeps an edit saved since when the old update landed", async () => {
      const seeded = await seedUncertainPostUpdate({
        post: { status: "draft", summary: NEWER },
      })
      googleHolds(seeded.googlePostName, SENT.summary)
      await runTick()
      expect(
        await postState(seeded.postId, seeded.attemptId, seeded.operationId)
      ).toMatchObject({
        status: "draft",
        summary: NEWER,
        attemptStatus: "succeeded",
        state: "confirmed_applied",
      })
    }, 60_000)

    it("publishes the post when it still holds the content that landed", async () => {
      const seeded = await seedUncertainPostUpdate({
        post: {
          status: "failed",
          summary: SENT.summary,
          lastErrorCode: "google_post_update_unconfirmed",
        },
      })
      googleHolds(seeded.googlePostName, SENT.summary)
      await runTick()
      expect(
        await postState(seeded.postId, seeded.attemptId, seeded.operationId)
      ).toMatchObject({
        status: "published",
        lastErrorCode: null,
        attemptStatus: "succeeded",
        state: "confirmed_applied",
      })
    }, 60_000)
  })
})
