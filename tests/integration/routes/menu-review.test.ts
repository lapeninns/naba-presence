import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { foodMenusResponseSchema } from "@/lib/contracts/location-food-menus"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import {
  createTestTenant,
  destroyTenants,
  seedGoogleConnection,
  seedLinkedReview,
} from "../helpers/tenant"

const describeDatabase =
  process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

describeDatabase("menu replacement review safety", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_FOOD_MENUS_ENABLED: "true",
      PUBLISH_ENABLED: "true",
    })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  it("rejects unresolved and stale reviews before Google writes, and exposes saved comparison counts", async () => {
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
    const menu = (descriptions: string[]) => [
      {
        labels: [{ displayName: "Menu" }],
        sections: [
          {
            labels: [{ displayName: "Starters" }],
            items: descriptions.map((description) => ({
              labels: [{ displayName: "Soup", description }],
            })),
          },
        ],
      },
    ]
    let providerMenus = menu(["A", "B"])
    let writes = 0
    google.respond(
      { method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` },
      () => ({
        status: 200,
        json: {
          name: linked.googleLocationName,
          metadata: { canHaveFoodMenus: true },
        },
      })
    )
    google.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({
      status: 200,
      json: { menus: providerMenus },
    }))
    google.respond({ method: "PATCH", pathIncludes: "/foodMenus" }, () => {
      writes += 1
      return { status: 500, json: { error: { message: "unexpected write" } } }
    })
    const root = `${server.baseUrl}/api/locations/${linked.locationId}`
    const headers = { cookie: owner.cookie, "content-type": "application/json" }
    const read = async () => {
      const response = await fetch(`${root}/food-menus`, { headers })
      expect(response.status, await response.clone().text()).toBe(200)
      return foodMenusResponseSchema.parse(await response.json()).foodMenus
    }
    const initial = await read()
    const saved = await fetch(`${root}/food-menus`, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        expectedCanonicalRevision: initial.canonicalResource.revision,
        menus: menu(["C", "D"]),
      }),
    })
    expect(saved.status, await saved.clone().text()).toBe(200)
    const reviewed = await read()
    const body = {
      confirmation: "publish_nabapresence_food_menus_to_google",
      expectedCanonicalRevision: reviewed.canonicalResource.revision,
      expectedCanonicalHash: reviewed.canonicalHash,
      expectedGoogleHash: reviewed.googleHash,
      confirmFullReplacement: true,
    }
    const ambiguous = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    expect(ambiguous.status).toBe(409)
    expect(await ambiguous.text()).toContain("food_menus_unresolved")
    expect(writes).toBe(0)

    const summary = await fetch(`${root}/summary`, { headers })
    expect(summary.status).toBe(200)
    expect(await summary.json()).toMatchObject({
      summary: { menu: { status: "core_dirty", dirtyCount: 1 } },
    })

    providerMenus = menu(["New Google", "B"])
    const stale = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    })
    expect(stale.status).toBe(409)
    expect(await stale.text()).toContain("food_menus_stale")
    expect(writes).toBe(0)
    const after = await read()
    expect(after.canonicalMenus).toEqual(menu(["C", "D"]))
  }, 30_000)
})
