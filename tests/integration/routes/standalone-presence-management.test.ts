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

describeDatabase("standalone NabaPresence canonical management", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []

  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({
      GOOGLE_API_PROXY_BASE: google.baseUrl,
      GBP_PROFILE_WRITES_ENABLED: "true",
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

  it("initializes from Google, supports local CRUD, publishes, and reconciles without a venue mapping", async () => {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const linked = await seedLinkedReview(admin, {
      organisationId: owner.organisationId,
      connectionId: connection.connectionId,
      googleAccountName: connection.googleAccountName,
    })

    let providerLocation: Record<string, unknown> = {
      name: linked.googleLocationName,
      title: "Old Crown",
      profile: { description: "Village pub" },
      phoneNumbers: { primaryPhone: "+44 1223 000000" },
      websiteUri: "https://old-crown.example",
      regularHours: {
        periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 11, minutes: 0 }, closeTime: { hours: 23, minutes: 0 } }],
      },
      specialHours: { specialHourPeriods: [] },
      moreHours: [],
      categories: { primaryCategory: { displayName: "Pub", moreHoursTypes: [{ hoursTypeId: "KITCHEN" }] } },
      metadata: { canHaveFoodMenus: true, mapsUri: "https://maps.example/old-crown", newReviewUri: "https://reviews.example/old-crown" },
    }
    let providerMenus: Array<Record<string, unknown>> = []

    google.respond({ method: "GET", pathIncludes: `/v1/${linked.googleLocationName}` }, () => ({ status: 200, json: providerLocation }))
    google.respond({ method: "PATCH", pathIncludes: `/v1/${linked.googleLocationName}` }, (call) => {
      const url = new URL(call.path, google.baseUrl)
      if (url.searchParams.get("validateOnly") !== "true") {
        providerLocation = { ...providerLocation, ...(call.body as Record<string, unknown>) }
      }
      return { status: 200, json: providerLocation }
    })
    google.respond({ method: "GET", pathIncludes: "/foodMenus" }, () => ({ status: 200, json: { menus: providerMenus } }))
    google.respond({ method: "PATCH", pathIncludes: "/foodMenus" }, (call) => {
      providerMenus = (call.body as { menus: Array<Record<string, unknown>> }).menus
      return { status: 200, json: { menus: providerMenus } }
    })

    const root = `${server.baseUrl}/api/locations/${linked.locationId}`
    const initialHours = await getJson(`${root}/hours`, owner.cookie, "hours")
    const initialProfile = await getJson(`${root}/profile`, owner.cookie, "profile")
    const initialMenus = await getJson(`${root}/food-menus`, owner.cookie, "foodMenus")
    expect(initialHours.canonicalResource.revision).toBe("1")
    expect(initialHours.status).toBe("in_sync")
    expect(initialProfile.fields.find((field: { key: string }) => field.key === "name").canonicalValue).toBe("Old Crown")
    expect(initialMenus.canonicalMenus).toEqual([])

    const changedHours = structuredClone(initialHours.canonical)
    changedHours.regular[1].periods[0].closesAt = "22:00"
    const saveHours = await fetch(`${root}/hours`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-hours"),
      body: JSON.stringify({ expectedCanonicalRevision: "1", hours: changedHours }),
    })
    expect(saveHours.status, await saveHours.clone().text()).toBe(200)
    expect(await saveHours.json()).toMatchObject({ saved: true, revision: "2" })

    const reviewedHours = await getJson(`${root}/hours`, owner.cookie, "hours")
    const publishHours = await fetch(`${root}/hours`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-hours"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_hours_to_google",
        expectedCanonicalRevision: reviewedHours.canonicalResource.revision,
        expectedCanonicalHash: reviewedHours.canonicalHash,
        expectedGoogleHash: reviewedHours.googleHash,
        approvedUpdateMask: reviewedHours.updateMask,
        confirmOverwriteGoogleChanges: false,
      }),
    })
    expect(publishHours.status, await publishHours.clone().text()).toBe(200)
    expect(await publishHours.json()).toMatchObject({ status: "published" })

    const saveProfile = await fetch(`${root}/profile`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-profile"),
      body: JSON.stringify({
        expectedCanonicalRevision: initialProfile.canonicalResource.revision,
        values: { name: "The Old Crown", website: "https://the-old-crown.example" },
      }),
    })
    expect(saveProfile.status, await saveProfile.clone().text()).toBe(200)
    const reviewedProfile = await getJson(`${root}/profile`, owner.cookie, "profile")
    const publishProfile = await fetch(`${root}/profile`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-profile"),
      body: JSON.stringify({
        direction: "to_google",
        confirmation: "publish_nabapresence_profile_to_google",
        selectedFields: ["name", "website"],
        expectedCanonicalRevision: reviewedProfile.canonicalResource.revision,
        expectedCanonicalHash: reviewedProfile.canonicalHash,
        expectedGoogleHash: reviewedProfile.googleHash,
        confirmOverwriteGoogleChanges: false,
        confirmOverwriteCanonicalChanges: false,
      }),
    })
    expect(publishProfile.status, await publishProfile.clone().text()).toBe(200)
    expect(providerLocation).toMatchObject({ title: "The Old Crown", websiteUri: "https://the-old-crown.example" })

    const canonicalMenus = [{
      labels: [{ displayName: "Main", languageCode: "en-GB" }],
      sections: [{
        labels: [{ displayName: "Mains", languageCode: "en-GB" }],
        items: [{
          labels: [{ displayName: "Steak pie", languageCode: "en-GB" }],
          attributes: { price: { currencyCode: "GBP", units: "16", nanos: 0 } },
        }],
      }],
    }]
    const saveMenus = await fetch(`${root}/food-menus`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "save-menus"),
      body: JSON.stringify({ expectedCanonicalRevision: initialMenus.canonicalResource.revision, menus: canonicalMenus }),
    })
    expect(saveMenus.status, await saveMenus.clone().text()).toBe(200)
    const reviewedMenus = await getJson(`${root}/food-menus`, owner.cookie, "foodMenus")
    const publishMenus = await fetch(`${root}/food-menus`, {
      method: "POST",
      headers: jsonHeaders(owner.cookie, "publish-menus"),
      body: JSON.stringify({
        confirmation: "publish_nabapresence_food_menus_to_google",
        expectedCanonicalRevision: reviewedMenus.canonicalResource.revision,
        expectedCanonicalHash: reviewedMenus.canonicalHash,
        expectedGoogleHash: reviewedMenus.googleHash,
        confirmFullReplacement: true,
      }),
    })
    expect(publishMenus.status, await publishMenus.clone().text()).toBe(200)
    expect(providerMenus).toEqual(canonicalMenus)

    const stale = await fetch(`${root}/hours`, {
      method: "PUT",
      headers: jsonHeaders(owner.cookie, "stale-hours"),
      body: JSON.stringify({ expectedCanonicalRevision: "1", hours: changedHours }),
    })
    expect(stale.status).toBe(409)

    const resources = await admin<{ resourceType: string; revision: string }[]>`
      select resource_type as "resourceType", revision::text as revision
      from presence_canonical_resource
      where organisation_id = ${owner.organisationId}
      order by resource_type
    `
    expect(resources).toEqual([
      { resourceType: "food_menus", revision: "2" },
      { resourceType: "hours", revision: "2" },
      { resourceType: "profile", revision: "2" },
    ])
  }, 30_000)
})

async function getJson(url: string, cookie: string, key: string) {
  const response = await fetch(url, { headers: { cookie } })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json())[key]
}

function jsonHeaders(cookie: string, requestId: string) {
  return { cookie, "content-type": "application/json", "x-request-id": requestId }
}
