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

describeDatabase("Google media management", () => {
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

  it("reconciles owner/customer media and performs stale-safe CRUD", async () => {
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
    const parent = `${connection.googleAccountName}/${linked.googleLocationName}`
    let merchant: Array<Record<string, unknown>> = []
    const customer = [
      {
        name: `${parent}/media/customer-1`,
        mediaFormat: "PHOTO",
        locationAssociation: { category: "FOOD_AND_DRINK" },
        googleUrl: "https://google.example/customer.jpg",
        thumbnailUrl: "https://google.example/customer-thumb.jpg",
        attribution: {
          profileName: "Guest photographer",
          profileUrl: "https://maps.google.com/profile/guest",
          takedownUrl: "https://support.google.com/report/customer-1",
        },
        createTime: "2026-07-01T10:00:00Z",
      },
    ]

    google.respond(
      { method: "GET", pathIncludes: "/media?" },
      () => ({ status: 200, json: { mediaItems: merchant } })
    )
    google.respond(
      { method: "GET", pathIncludes: "/media/customers" },
      () => ({ status: 200, json: { mediaItems: customer } })
    )
    google.respond(
      { method: "POST", pathIncludes: "/media" },
      (call) => {
        const created = {
          name: `${parent}/media/merchant-1`,
          ...(call.body as Record<string, unknown>),
          googleUrl: "https://google.example/merchant.jpg",
          thumbnailUrl: "https://google.example/merchant-thumb.jpg",
          createTime: "2026-07-31T10:00:00Z",
        }
        merchant.push(created)
        return { status: 200, json: created }
      }
    )
    google.respond(
      { method: "GET", pathIncludes: "/media/merchant-1" },
      () => ({ status: 200, json: merchant[0] })
    )
    google.respond(
      { method: "PATCH", pathIncludes: "/media/merchant-1" },
      (call) => {
        const body = call.body as {
          locationAssociation?: { category?: string }
        }
        merchant = merchant.map((item) => ({
          ...item,
          locationAssociation: {
            category: body.locationAssociation?.category,
          },
        }))
        return { status: 200, json: merchant[0] }
      }
    )
    google.respond(
      { method: "DELETE", pathIncludes: "/media/merchant-1" },
      () => {
        merchant = []
        return { status: 200, json: {} }
      }
    )

    const base = `${server.baseUrl}/api/locations/${linked.locationId}/media`
    const initial = await fetch(base, { headers: { cookie: owner.cookie } })
    expect(initial.status, await initial.clone().text()).toBe(200)
    expect((await initial.json()).media).toMatchObject({
      writesEnabled: true,
      items: [
        {
          ownership: "customer",
          attribution: {
            profileName: "Guest photographer",
            takedownUrl: "https://support.google.com/report/customer-1",
          },
        },
      ],
    })

    const create = await fetch(base, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "create-media"),
      body: JSON.stringify({
        confirmation: "create_google_media",
        mediaFormat: "PHOTO",
        category: "FOOD_AND_DRINK",
        sourceUrl: "https://images.example.com/dish.jpg",
        description: "Momo platter",
      }),
    })
    expect(create.status, await create.clone().text()).toBe(201)
    expect(await create.json()).toMatchObject({ status: "succeeded" })

    const afterCreate = await fetch(`${base}?refresh=1`, {
      headers: { cookie: owner.cookie },
    })
    const merchantItem = (await afterCreate.json()).media.items.find(
      (item: { ownership: string }) => item.ownership === "merchant"
    )
    expect(merchantItem).toMatchObject({
      category: "FOOD_AND_DRINK",
      sourceUrl: "https://images.example.com/dish.jpg",
      description: "Momo platter",
    })

    const stale = await fetch(`${base}/${merchantItem.id}`, {
      method: "PATCH",
      headers: jsonHeaders(owner.cookie, "stale-media"),
      body: JSON.stringify({
        confirmation: "update_google_media",
        category: "INTERIOR",
        expectedGoogleHash: "0".repeat(64),
      }),
    })
    expect(stale.status).toBe(409)

    const update = await fetch(`${base}/${merchantItem.id}`, {
      method: "PATCH",
      headers: jsonHeaders(owner.cookie, "update-media"),
      body: JSON.stringify({
        confirmation: "update_google_media",
        category: "INTERIOR",
        expectedGoogleHash: merchantItem.googleHash,
      }),
    })
    expect(update.status, await update.clone().text()).toBe(200)

    const afterUpdate = await fetch(`${base}?refresh=1`, {
      headers: { cookie: owner.cookie },
    })
    const updated = (await afterUpdate.json()).media.items.find(
      (item: { ownership: string }) => item.ownership === "merchant"
    )
    expect(updated.category).toBe("INTERIOR")

    const remove = await fetch(`${base}/${merchantItem.id}`, {
      method: "DELETE",
      headers: jsonHeaders(owner.cookie, "delete-media"),
      body: JSON.stringify({
        confirmation: "delete_google_media",
        expectedGoogleHash: updated.googleHash,
      }),
    })
    expect(remove.status, await remove.clone().text()).toBe(200)

    const final = await fetch(`${base}?refresh=1`, {
      headers: { cookie: owner.cookie },
    })
    expect((await final.json()).media.items).toMatchObject([
      { ownership: "customer" },
    ])
    const [ledger] = await admin<{ count: string }[]>`
      select count(*)::text as count
      from gbp_media_mutation
      where organisation_id = ${owner.organisationId}
        and status = 'succeeded'
    `
    expect(Number(ledger.count)).toBe(3)
  }, 30_000)

  it("hands a create Google answered without the item name to a person when no item matches", async () => {
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
    // 2xx, but not the created item: the photo may exist on Google now.
    google.respond({ method: "POST", pathIncludes: "/media" }, () => ({
      status: 200,
      json: {},
    }))

    const create = await fetch(
      `${server.baseUrl}/api/locations/${linked.locationId}/media`,
      {
        method: "POST",
        headers: jsonHeaders(owner.cookie, "create-media-nameless"),
        body: JSON.stringify({
          confirmation: "create_google_media",
          mediaFormat: "PHOTO",
          category: "FOOD_AND_DRINK",
          sourceUrl: "https://images.example.com/nameless.jpg",
        }),
      }
    )
    // The live list holds no matching item, so it is neither adopted nor
    // sent again (tests/integration/routes/media-checkpoints.test.ts).
    expect(create.status, await create.clone().text()).toBe(502)
    expect((await create.json()).error).toBe("media_needs_resolution")

    const [attempt] = await admin<{ status: string; uploadPhase: string }[]>`
      select status, upload_phase as "uploadPhase"
      from gbp_media_mutation
      where organisation_id = ${owner.organisationId}
    `
    expect(attempt).toEqual({
      status: "needs_resolution",
      uploadPhase: "create_sent",
    })
  }, 30_000)

  it("pages the library by keyset cursor without gaps or repeats while the cache changes", async () => {
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
    const parent = `${connection.googleAccountName}/${linked.googleLocationName}`
    const item = (name: string, createTime?: string) => ({
      name: `${parent}/media/${name}`,
      mediaFormat: "PHOTO",
      locationAssociation: { category: "INTERIOR" },
      googleUrl: `https://google.example/${name}.jpg`,
      ...(createTime ? { createTime } : {}),
    })
    google.reset()
    google.respond({ method: "GET", pathIncludes: "/media?" }, () => ({
      status: 200,
      json: { mediaItems: [item("m-new", "2026-07-03T10:00:00Z"), item("m-tie-a", "2026-07-02T10:00:00.000001Z"), item("m-tie-b", "2026-07-02T10:00:00.000001Z"), item("m-undated")] },
    }))
    google.respond({ method: "GET", pathIncludes: "/media/customers" }, () => ({
      status: 200,
      json: { mediaItems: [item("c-old", "2026-07-01T10:00:00Z"), item("c-new", "2026-07-05T10:00:00Z")] },
    }))
    const base = `${server.baseUrl}/api/locations/${linked.locationId}/media`
    const read = async (query: string) => {
      const response = await fetch(`${base}${query}`, { headers: { cookie: owner.cookie } })
      expect(response.status, await response.clone().text()).toBe(200)
      return (await response.json()).media as { items: { id: string; googleMediaName: string }[]; total: number; nextCursor: string | null }
    }
    const first = await read("?pageSize=2")
    expect(first.total).toBe(6)
    const reads = () => google.calls.filter((call) => call.method === "GET").length
    const readsAfterFirst = reads()
    const ids = new Map(
      (await admin<{ id: string; name: string }[]>`select id::text as id, google_media_name as name from gbp_media_item where location_id = ${linked.locationId}`)
        .map((row) => [row.name.split("/").at(-1) as string, row.id])
    )
    const tied = [ids.get("m-tie-a"), ids.get("m-tie-b")].sort()
    // Customer items first (ownership sorts by name), newest first, undated last.
    const expected = [ids.get("c-new"), ids.get("c-old"), ids.get("m-new"), ...tied, ids.get("m-undated")]

    // A newer customer item cached between pages sorts above the cursor.
    await admin`
      insert into gbp_media_item (organisation_id, location_id, external_location_id, google_media_name, ownership, media_format, google_hash, google_create_time)
      select organisation_id, location_id, external_location_id, ${`${parent}/media/c-later`}, 'customer', 'PHOTO', 'hash', '2026-08-01T00:00:00Z'
      from gbp_media_item where location_id = ${linked.locationId} limit 1`
    const pages = [first]
    while (pages.at(-1)?.nextCursor) {
      pages.push(await read(`?pageSize=2&cursor=${pages.at(-1)?.nextCursor}`))
    }
    expect(pages.map((page) => page.items.length)).toEqual([2, 2, 2])
    expect(pages.flatMap((page) => page.items.map((row) => row.id))).toEqual(expected)
    // Later pages read the cache only; they never re-list Google.
    expect(reads()).toBe(readsAfterFirst)

    // A cursor belongs to its filters and location.
    const merchantOnly = await read("?pageSize=1&ownership=merchant")
    expect(merchantOnly.total).toBe(4)
    for (const query of [`?cursor=${merchantOnly.nextCursor}`, `?ownership=customer&cursor=${merchantOnly.nextCursor}`, "?cursor=garbage"]) {
      const refused = await fetch(`${base}${query}`, { headers: { cookie: owner.cookie } })
      expect(refused.status).toBe(400)
      expect((await refused.json()).error).toBe("invalid_cursor")
    }
  })
})

function jsonHeaders(cookie: string, requestId: string) {
  return {
    cookie,
    "content-type": "application/json",
    "x-request-id": requestId,
  }
}
