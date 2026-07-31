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

    const afterCreate = await fetch(base, {
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

    const afterUpdate = await fetch(base, {
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

    const final = await fetch(base, { headers: { cookie: owner.cookie } })
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
})

function jsonHeaders(cookie: string, requestId: string) {
  return {
    cookie,
    "content-type": "application/json",
    "x-request-id": requestId,
  }
}
