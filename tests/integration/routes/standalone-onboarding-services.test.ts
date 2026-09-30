import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { googleOnboardingDraftSchema, googleOnboardingReviewSchema, type GoogleOnboardingDraft } from "@/lib/contracts/google-onboarding"
import { onboardingServicesResponseSchema } from "@/lib/contracts/google-onboarding-services"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection } from "../helpers/tenant"

const database = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

database("standalone onboarding service metadata", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL ?? "", DATABASE_POOL_MAX: "1", PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture(categories = true, serviceItems?: GoogleOnboardingDraft["payload"]["serviceItems"], moreHours?: GoogleOnboardingDraft["payload"]["moreHours"]) {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const [account] = await admin<{ id: string }[]>`select id::text from google_account where organisation_id = ${owner.organisationId}`
    if (!account) throw new Error("Missing fixture account")
    const payload: GoogleOnboardingDraft["payload"] = {
      title: "New service business", languageCode: "cy", serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB" },
      ...(categories ? { categories: { primaryCategory: { name: "categories/gcid:plumber" }, additionalCategories: [{ name: "categories/gcid:heating" }] } } : {}),
      ...(serviceItems ? { serviceItems } : {}),
      ...(moreHours ? { moreHours } : {}),
    }
    const path = `/api/google/accounts/${account.id}/drafts/${randomUUID()}`
    const response = await fetch(`${server.baseUrl}/api/google/accounts/${account.id}/drafts`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId: path.split("/").at(-1), connectionId: connection.connectionId, payload }) })
    expect(response.status, await response.clone().text()).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await response.json())
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}` }, () => ({ status: 200, json: { name: connection.googleAccountName } }))
    return { ...owner, ...connection, path, draft }
  }

  function load(owner: Awaited<ReturnType<typeof fixture>>, revision = 1, cookie = owner.cookie) {
    return fetch(`${server.baseUrl}${owner.path}/services?expectedRevision=${revision}`, { headers: { cookie } })
  }

  it.each(["complete", "empty-services", "incomplete", "malformed", "malformed-hours", "edited", "revoked"] as const)("loads saved category service metadata: %s", async (scenario) => {
    const owner = await fixture()
    let calls = 0
    google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, async (call) => {
      calls++
      const query = new URL(call.path, google.baseUrl).searchParams
      expect(query.getAll("names")).toEqual(["gcid:plumber", "gcid:heating"])
      expect(query.get("regionCode")).toBe("GB")
      expect(query.get("languageCode")).toBe("cy")
      expect(query.get("view")).toBe("FULL")
      if (scenario === "edited") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
      if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
      return { status: 200, json: scenario === "malformed" ? { categories: "invalid" } : { categories: [
        ...(scenario === "incomplete" ? [] : [{ name: "categories/gcid:heating", displayName: "Heating", serviceTypes: [], moreHoursTypes: [{ hoursTypeId: "provider:delivery", displayName: "Delivery", localizedDisplayName: "Delivery hours" }] }]),
        { name: "categories/gcid:plumber", displayName: "Plumber", serviceTypes: scenario === "empty-services" ? [] : [{ serviceTypeId: "job:repair", displayName: "Repair" }], ...(scenario === "malformed-hours" ? { moreHoursTypes: [{ hoursTypeId: " " }] } : {}) },
      ] } }
    })
    const response = await load(owner)
    const expectedStatus = scenario === "incomplete" || scenario === "edited" ? 409 : scenario === "malformed" || scenario === "malformed-hours" ? 502 : scenario === "revoked" ? 404 : 200
    expect(response.status, await response.clone().text()).toBe(expectedStatus)
    expect(calls).toBe(1)
    if (response.ok) {
      const data = onboardingServicesResponseSchema.parse(await response.json())
      expect(data).toMatchObject({ draftId: owner.draft.id, revision: 1, payloadHash: owner.draft.payloadHash, languageCode: "cy", regionCode: "GB" })
      expect(data.categories).toHaveLength(2)
      expect(data.categories.find((item) => item.name === "categories/gcid:heating")?.moreHoursTypes).toEqual([{ hoursTypeId: "provider:delivery", displayName: "Delivery", localizedDisplayName: "Delivery hours" }])
    }
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  })

  it.each(["stale", "missing-category", "account-denied", "account-unconfirmed", "cross-tenant", "viewer"] as const)("rejects invalid scope before category discovery: %s", async (scenario) => {
    const owner = await fixture(scenario !== "missing-category")
    let calls = 0
    google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, () => { calls++; return { status: 200, json: { categories: [] } } })
    if (scenario === "account-denied" || scenario === "account-unconfirmed") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: scenario === "account-denied" ? 403 : 200, json: scenario === "account-denied" ? { error: { status: "PERMISSION_DENIED" } } : { name: "accounts/wrong" } }))
    const other = scenario === "cross-tenant" || scenario === "viewer" ? await createTestTenant(admin, { role: scenario === "viewer" ? "viewer" : "owner" }) : null
    if (other) organisations.push(other.organisationId)
    const response = await load(owner, scenario === "stale" ? 2 : 1, other?.cookie ?? owner.cookie)
    expect(response.status).toBe(scenario === "viewer" || scenario === "account-denied" ? 403 : scenario === "cross-tenant" ? 404 : scenario === "account-unconfirmed" ? 502 : 409)
    expect(calls).toBe(0)
  })

  it.each(["structured", "free-form", "unsupported-structured", "unsupported-category", "changed-after-approval", "hours", "unsupported-hours", "hours-changed-after-approval"] as const)("checks service eligibility before validation and creation: %s", async (scenario) => {
    const freeForm = scenario === "free-form" || scenario === "unsupported-category"
    const hoursScenario = scenario === "hours" || scenario === "unsupported-hours" || scenario === "hours-changed-after-approval"
    const owner = await fixture(true, hoursScenario ? undefined : [freeForm
      ? { freeFormServiceItem: { category: scenario === "unsupported-category" ? "gcid:hotel" : "gcid:plumber", label: { displayName: "Pipe inspection", languageCode: "cy" } } }
      : { structuredServiceItem: { serviceTypeId: scenario === "unsupported-structured" ? "job:unknown" : "job:repair", description: "Repair pipes" }, price: { currencyCode: "GBP", units: "25" } },
    ], hoursScenario ? [{ hoursTypeId: scenario === "unsupported-hours" ? "DELIVERY" : "provider:delivery", periods: [{ openDay: "SATURDAY", openTime: { hours: 22 }, closeDay: "SUNDAY", closeTime: { hours: 2 } }] }] : undefined)
    const post = (suffix: string, body: unknown) => fetch(`${server.baseUrl}${owner.path}${suffix}`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify(body) })
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: [] } }))
    const matched = await post("/matches", { expectedRevision: 1 })
    expect(matched.status).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await matched.json())
    if (!draft.matchResult) throw new Error("Missing fixture matches")
    let supported = true
    google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, () => ({ status: 200, json: { categories: [
      { name: "categories/gcid:plumber", serviceTypes: supported ? [{ serviceTypeId: "job:repair" }] : [] },
      { name: "categories/gcid:heating", serviceTypes: [], moreHoursTypes: supported ? [{ hoursTypeId: "provider:delivery" }] : [] },
    ] } }))
    let validations = 0
    let creations = 0
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, (call) => {
      const validateOnly = new URL(call.path, google.baseUrl).searchParams.get("validateOnly") === "true"
      if (validateOnly) validations++
      else creations++
      expect(call.body).toEqual(owner.draft.payload)
      return { status: 200, json: {} }
    })
    const response = await post("/reviews", { expectedRevision: 1, expectedMatchCheckedAt: draft.matchResult.checkedAt, decision: { action: "create_new", acknowledgedMatchNames: [], reason: "Separate genuine business" } })
    if (scenario === "unsupported-structured" || scenario === "unsupported-category" || scenario === "unsupported-hours") {
      expect(response.status).toBe(422)
      if (scenario === "unsupported-hours") expect(await response.json()).toMatchObject({ error: "onboarding_hours_type_unsupported" })
      expect(validations).toBe(0)
      expect(await admin`select id from google_onboarding_review where draft_id = ${draft.id}`).toHaveLength(0)
      return
    }
    expect(response.status, await response.clone().text()).toBe(200)
    expect(validations).toBe(1)
    const review = googleOnboardingReviewSchema.parse(await response.json())
    expect(review.payload.serviceItems).toEqual(owner.draft.payload.serviceItems)
    expect(review.payload.moreHours).toEqual(owner.draft.payload.moreHours)
    if (scenario === "changed-after-approval" || scenario === "hours-changed-after-approval") {
      expect((await post(`/reviews/${review.id}`, { expectedReviewHash: review.reviewHash })).status).toBe(200)
      supported = false
      expect((await post("/creation", { reviewId: review.id, expectedReviewHash: review.reviewHash })).status).toBe(422)
      expect(creations).toBe(0)
      expect(await admin`select id from google_onboarding_creation where draft_id = ${draft.id}`).toHaveLength(0)
    }
  })
})
