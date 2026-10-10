import { randomUUID } from "node:crypto"

import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

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
 * Media upload checkpoints and create reconciliation (plan P03-S5,
 * lib/server/media.ts): a failure before the create is sent is a plain,
 * retryable failure; an uncertain create is adopted from the live list when
 * one item matches, and otherwise waits on a person, blocking a re-create.
 */
describeDatabase("Media upload checkpoints", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_MEDIA_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })

  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function setup() {
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
    const location = linked.googleLocationName
    const parent = `${connection.googleAccountName}/${location}`
    const merchant: Array<Record<string, unknown>> = []
    google.respond(
      { method: "GET", pathIncludes: `${location}/media?` },
      () => ({ status: 200, json: { mediaItems: merchant } })
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/customers` },
      () => ({ status: 200, json: { mediaItems: [] } })
    )
    const base = `${server.baseUrl}/api/locations/${linked.locationId}/media`
    const attempts = () =>
      admin<
        {
          id: string
          status: string
          uploadPhase: string
          uploadDataRef: string | null
          contentSha256: string | null
          resolution: string | null
          googleName: string | null
        }[]
      >`
        select id::text as id, status, upload_phase as "uploadPhase",
          upload_data_ref as "uploadDataRef", content_sha256 as "contentSha256",
          resolution, google_response->>'name' as "googleName"
        from gbp_media_mutation
        where organisation_id = ${owner.organisationId}
        order by created_at
      `
    const receipt = (attemptId: string) =>
      admin<{ state: string; errorCode: string | null }[]>`
        select state, error_code as "errorCode"
        from mutation_operation
        where organisation_id = ${owner.organisationId}
          and attempt_table = 'gbp_media_mutation'
          and attempt_id = ${attemptId}
      `.then(([row]) => row)
    return {
      owner,
      locationId: linked.locationId,
      location,
      parent,
      merchant,
      base,
      attempts,
      receipt,
    }
  }

  /** Stubs a byte upload's first two calls, so only the create is left. */
  function stubUploadReservation(location: string) {
    const resourceName = `ref-${randomUUID()}`
    google.respond(
      { method: "POST", pathIncludes: `${location}/media:startUpload` },
      () => ({ status: 200, json: { resourceName } })
    )
    google.respond(
      { method: "POST", pathIncludes: `/upload/v1/media/${resourceName}` },
      () => ({ status: 200, json: {} })
    )
  }

  function uploadPhoto(
    base: string,
    cookie: string,
    requestId: string,
    headers: Record<string, string> = {}
  ) {
    const form = new FormData()
    form.set(
      "file",
      new File([new Uint8Array(12 * 1024).fill(9)], "dish.jpg", {
        type: "image/jpeg",
      })
    )
    form.set("mediaFormat", "PHOTO")
    form.set("category", "FOOD_AND_DRINK")
    form.set("confirmation", "create_google_media")
    return fetch(base, {
      method: "POST",
      headers: { cookie, "x-request-id": requestId, ...headers },
      body: form,
    })
  }

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

  const createBody = (sourceUrl: string) =>
    JSON.stringify({
      confirmation: "create_google_media",
      mediaFormat: "PHOTO",
      category: "FOOD_AND_DRINK",
      sourceUrl,
      description: "Momo platter",
    })

  it("settles a failure before create_sent as failed, and a retry uploads afresh", async () => {
    const { owner, location, parent, merchant, base, attempts } = await setup()
    const resourceName = `ref-${randomUUID()}`
    google.respond(
      { method: "POST", pathIncludes: `${location}/media:startUpload` },
      () => ({ status: 200, json: { resourceName } })
    )
    let uploadStatus = 503
    google.respond(
      { method: "POST", pathIncludes: `/upload/v1/media/${resourceName}` },
      () => ({ status: uploadStatus, json: {} })
    )
    let creates = 0
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      (call) => {
        creates += 1
        const created = {
          ...(call.body as Record<string, unknown>),
          name: `${parent}/media/uploaded-${creates}`,
          createTime: new Date().toISOString(),
        }
        merchant.push(created)
        return { status: 200, json: created }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/uploaded-` },
      (call) => ({
        status: 200,
        json: merchant.find((item) => call.path.endsWith(String(item.name))),
      })
    )

    const upload = (requestId: string) => {
      const form = new FormData()
      form.set(
        "file",
        new File([new Uint8Array(12 * 1024).fill(7)], "dish.jpg", {
          type: "image/jpeg",
        })
      )
      form.set("mediaFormat", "PHOTO")
      form.set("category", "FOOD_AND_DRINK")
      form.set("confirmation", "create_google_media")
      return fetch(base, {
        method: "POST",
        headers: { cookie: owner.cookie, "x-request-id": requestId },
        body: form,
      })
    }

    // The bytes upload times out: the item cannot exist, nothing was created.
    const first = await upload("upload-interrupted")
    expect(first.status, await first.clone().text()).toBe(502)
    expect((await first.json()).error).toBe("media_upload_interrupted")
    expect(creates).toBe(0)
    const [failed] = await attempts()
    expect(failed).toMatchObject({
      status: "failed",
      uploadPhase: "data_ref_obtained",
      uploadDataRef: resourceName,
    })
    expect(failed.contentSha256).toMatch(/^[0-9a-f]{64}$/)

    // Not blocked: the same photo uploads again from a new reference.
    uploadStatus = 200
    const retry = await upload("upload-retry")
    expect(retry.status, await retry.clone().text()).toBe(201)
    expect(await retry.json()).toMatchObject({ status: "succeeded" })
    expect(creates).toBe(1)
    const rows = await attempts()
    expect(rows[1]).toMatchObject({
      status: "succeeded",
      uploadPhase: "create_sent",
      resolution: null,
      contentSha256: failed.contentSha256,
    })
  }, 30_000)

  it("adopts the single live item that matches an uncertain create", async () => {
    const { owner, location, parent, merchant, base, attempts } = await setup()
    const sourceUrl = `https://images.example.com/${randomUUID()}.jpg`
    // Google applies the create, but the answer never arrives (5xx).
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      (call) => {
        merchant.push({
          ...(call.body as Record<string, unknown>),
          name: `${parent}/media/landed-1`,
          createTime: new Date().toISOString(),
        })
        return { status: 503, json: {} }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/landed-1` },
      () => ({ status: 200, json: merchant[0] })
    )

    const create = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-uncertain"),
      body: createBody(sourceUrl),
    })
    expect(create.status, await create.clone().text()).toBe(201)
    expect(await create.json()).toMatchObject({ status: "succeeded" })
    const [attempt] = await attempts()
    expect(attempt).toMatchObject({
      status: "succeeded",
      uploadPhase: "create_sent",
      resolution: "adopted",
      googleName: `${parent}/media/landed-1`,
    })
  }, 30_000)

  it("hands an unmatched uncertain create to a person and blocks a re-create until resolved", async () => {
    const { owner, location, parent, merchant, base, attempts, receipt } =
      await setup()
    const sourceUrl = `https://images.example.com/${randomUUID()}.jpg`
    let createStatus = 503
    let creates = 0
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      (call) => {
        creates += 1
        if (createStatus !== 200) return { status: createStatus, json: {} }
        const created = {
          ...(call.body as Record<string, unknown>),
          name: `${parent}/media/after-resolution`,
          createTime: new Date().toISOString(),
        }
        merchant.push(created)
        return { status: 200, json: created }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/after-resolution` },
      () => ({ status: 200, json: merchant[0] })
    )

    const intentId = randomUUID()
    const first = await fetch(base, {
      method: "POST",
      headers: {
        ...jsonHeaders(owner.cookie, "create-unmatched"),
        "Idempotency-Key": intentId,
      },
      body: createBody(sourceUrl),
    })
    expect(first.status, await first.clone().text()).toBe(502)
    expect((await first.json()).error).toBe("media_needs_resolution")
    const [pending] = await attempts()
    expect(pending).toMatchObject({
      status: "needs_resolution",
      uploadPhase: "create_sent",
      resolution: null,
    })

    expect(await receipt(pending.id)).toMatchObject({ state: "uncertain" })

    // A retry under the same intent is answered from its receipt; one under
    // another intent is refused by the guard. Neither is sent.
    const sameIntent = await fetch(base, {
      method: "POST",
      headers: {
        ...jsonHeaders(owner.cookie, "create-same-intent"),
        "Idempotency-Key": intentId,
      },
      body: createBody(sourceUrl),
    })
    expect(sameIntent.status, await sameIntent.clone().text()).toBe(502)
    expect(await sameIntent.json()).toMatchObject({
      error: "media_needs_resolution",
      details: { outcome: "uncertain" },
    })

    // The next create of the same content is refused, not sent.
    const again = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-again"),
      body: createBody(sourceUrl),
    })
    expect(again.status, await again.clone().text()).toBe(409)
    const refused = await again.json()
    expect(refused.error).toBe("media_needs_resolution")
    expect(creates).toBe(1)

    // The photos tab lists it for a person to resolve.
    const listed = await fetch(base, { headers: { cookie: owner.cookie } })
    expect((await listed.json()).media.unresolvedCreates).toMatchObject([
      { attemptId: pending.id, sourceUrl, category: "FOOD_AND_DRINK" },
    ])

    const resolve = await fetch(`${base}/resolutions/${pending.id}`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "resolve-abandoned"),
      body: JSON.stringify({
        resolution: "abandoned",
        confirmation: "resolve_google_media",
      }),
    })
    expect(resolve.status, await resolve.clone().text()).toBe(200)
    expect(await resolve.json()).toMatchObject({
      id: pending.id,
      status: "failed",
    })
    expect((await attempts())[0]).toMatchObject({
      status: "failed",
      resolution: "abandoned",
    })
    expect(await receipt(pending.id)).toMatchObject({
      state: "failed",
      errorCode: "media_resolution_abandoned",
    })

    // Resolved twice is a conflict, not a second verdict.
    const twice = await fetch(`${base}/resolutions/${pending.id}`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "resolve-twice"),
      body: JSON.stringify({
        resolution: "adopted",
        confirmation: "resolve_google_media",
      }),
    })
    expect(twice.status).toBe(409)

    createStatus = 200
    const retry = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-after-resolution"),
      body: createBody(sourceUrl),
    })
    expect(retry.status, await retry.clone().text()).toBe(201)
    expect(creates).toBe(2)
  }, 30_000)

  it("adopts nothing while another create of the same kind is still open", async () => {
    const { owner, locationId, location, parent, merchant, base, attempts } =
      await setup()
    stubUploadReservation(location)
    // Another upload of the same category, sent a moment ago and not settled:
    // its photo is on Google, but its row does not name it yet.
    await admin`
      insert into gbp_media_mutation (
        organisation_id, location_id, actor_user_id, operation, status,
        idempotency_key, requested_payload, upload_phase, content_sha256
      ) values (
        ${owner.organisationId}, ${locationId}, ${owner.userId}, 'create',
        'started', ${`other-${randomUUID()}`},
        ${admin.json({ mediaFormat: "PHOTO", category: "FOOD_AND_DRINK" })},
        'create_sent', ${"e".repeat(64)}
      )
    `
    merchant.push({
      name: `${parent}/media/other-upload`,
      mediaFormat: "PHOTO",
      locationAssociation: { category: "FOOD_AND_DRINK" },
      createTime: new Date().toISOString(),
    })
    // This upload's create is lost and never landed.
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      () => ({ status: 503, json: {} })
    )

    const upload = await uploadPhoto(base, owner.cookie, "upload-contested")
    expect(upload.status, await upload.clone().text()).toBe(502)
    expect((await upload.json()).error).toBe("media_needs_resolution")
    const mine = (await attempts()).find(
      (row) => row.contentSha256 !== "e".repeat(64)
    )
    expect(mine).toMatchObject({
      status: "needs_resolution",
      resolution: null,
      googleName: null,
    })
  }, 30_000)

  it("sends one of two concurrent creates of the same content", async () => {
    const { owner, location, parent, merchant, base } = await setup()
    const sourceUrl = `https://images.example.com/${randomUUID()}.jpg`
    let creates = 0
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      (call) => {
        creates += 1
        const created = {
          ...(call.body as Record<string, unknown>),
          name: `${parent}/media/concurrent-${creates}`,
          createTime: new Date().toISOString(),
        }
        merchant.push(created)
        return { status: 200, json: created, delayMs: 300 }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/concurrent-` },
      (call) => ({
        status: 200,
        json: merchant.find((item) => call.path.endsWith(String(item.name))),
      })
    )
    const send = (requestId: string) =>
      fetch(base, {
        method: "POST",
        headers: {
          ...jsonHeaders(owner.cookie, requestId),
          "Idempotency-Key": randomUUID(),
        },
        body: createBody(sourceUrl),
      })
    const responses = await Promise.all([send("race-a"), send("race-b")])
    const statuses = responses.map((response) => response.status).sort()
    expect(statuses).toEqual([201, 409])
    const refused = responses.find((response) => response.status === 409)!
    expect((await refused.json()).error).toBe("media_create_in_progress")
    expect(creates).toBe(1)
  }, 30_000)

  it("settles the receipt when a person adopts, and lets recovery adopt a later match", async () => {
    const { owner, location, parent, merchant, base, attempts, receipt } =
      await setup()
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      () => ({ status: 503, json: {} })
    )
    const create = (sourceUrl: string, requestId: string) =>
      fetch(base, {
        method: "POST",
        headers: {
          ...jsonHeaders(owner.cookie, requestId),
          "Idempotency-Key": randomUUID(),
        },
        body: createBody(sourceUrl),
      })

    // A person adopts the first: its receipt is confirmed with it.
    const firstUrl = `https://images.example.com/${randomUUID()}.jpg`
    const first = await create(firstUrl, "adopt-first")
    expect(first.status, await first.clone().text()).toBe(502)
    const [adoptedRow] = await attempts()
    const resolve = await fetch(`${base}/resolutions/${adoptedRow.id}`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "adopt-resolve"),
      body: JSON.stringify({
        resolution: "adopted",
        confirmation: "resolve_google_media",
      }),
    })
    expect(resolve.status, await resolve.clone().text()).toBe(200)
    expect((await attempts())[0]).toMatchObject({
      status: "succeeded",
      resolution: "adopted",
    })
    expect(await receipt(adoptedRow.id)).toMatchObject({
      state: "confirmed_applied",
      errorCode: null,
    })

    // The second waits on a person, then its photo shows up on Google
    // (Google's list caught up) and the recovery job adopts it.
    const secondUrl = `https://images.example.com/${randomUUID()}.jpg`
    const second = await create(secondUrl, "recover-second")
    expect(second.status, await second.clone().text()).toBe(502)
    const pending = (await attempts())[1]
    expect(pending).toMatchObject({ status: "needs_resolution" })
    merchant.push({
      name: `${parent}/media/late-1`,
      mediaFormat: "PHOTO",
      locationAssociation: { category: "FOOD_AND_DRINK" },
      sourceUrl: secondUrl,
      description: "Momo platter",
      createTime: new Date().toISOString(),
    })
    // A person-adopted create names no item, so it contests any match until
    // it is older than the clock-skew allowance; date it out of the window.
    await admin`
      update gbp_media_mutation
      set finished_at = now() - interval '1 hour'
      where id = ${adoptedRow.id}
    `
    await admin`
      update mutation_operation set next_recovery_at = now() - interval '1 second'
      where attempt_id = ${pending.id}
    `
    await runTick()
    expect((await attempts())[1]).toMatchObject({
      status: "succeeded",
      resolution: "adopted",
      googleName: `${parent}/media/late-1`,
    })
    expect(await receipt(pending.id)).toMatchObject({
      state: "confirmed_applied",
    })
  }, 30_000)

  it("answers a same-intent retry from its receipt without creating again", async () => {
    const { owner, location, parent, merchant, base, attempts } = await setup()
    const sourceUrl = `https://images.example.com/${randomUUID()}.jpg`
    let creates = 0
    google.respond(
      { method: "POST", pathEndsWith: `${location}/media` },
      (call) => {
        creates += 1
        const created = {
          ...(call.body as Record<string, unknown>),
          name: `${parent}/media/intent-1`,
          createTime: new Date().toISOString(),
        }
        merchant.push(created)
        return { status: 200, json: created }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: `${location}/media/intent-1` },
      () => ({ status: 200, json: merchant[0] })
    )
    const intentId = randomUUID()
    const send = (requestId: string) =>
      fetch(base, {
        method: "POST",
        headers: {
          ...jsonHeaders(owner.cookie, requestId),
          "Idempotency-Key": intentId,
        },
        body: createBody(sourceUrl),
      })

    const first = await send("intent-first")
    expect(first.status, await first.clone().text()).toBe(201)
    const firstBody = await first.json()
    const second = await send("intent-retry")
    expect(second.status, await second.clone().text()).toBe(201)
    expect(await second.json()).toMatchObject({
      id: firstBody.id,
      idempotent: true,
    })
    expect(creates).toBe(1)
    expect(await attempts()).toHaveLength(1)
  }, 30_000)
})

function jsonHeaders(cookie: string, requestId: string) {
  return {
    cookie,
    "content-type": "application/json",
    "x-request-id": requestId,
  }
}
