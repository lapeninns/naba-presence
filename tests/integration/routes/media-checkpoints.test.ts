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
    return { owner, location, parent, merchant, base, attempts }
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
    const { owner, location, parent, merchant, base, attempts } = await setup()
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

    const first = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-unmatched"),
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
