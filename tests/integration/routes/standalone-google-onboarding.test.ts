import { randomUUID } from "node:crypto"
import type { z } from "zod"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { googleAccountMatchesResponseSchema, googleOnboardingDraftSchema, googleOnboardingReviewSchema, googleOnboardingCreationSchema } from "@/lib/contracts/google-onboarding"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection } from "../helpers/tenant"

const database = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

database("account-scoped Google onboarding matches", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL!, { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL!, DATABASE_POOL_MAX: "1", PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture(role: "owner" | "viewer" = "owner") {
    const owner = await createTestTenant(admin, { role })
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const [account] = await admin<{ id: string }[]>`select id::text as id from google_account where organisation_id = ${owner.organisationId}`
    return { ...owner, ...connection, accountId: account.id }
  }
  function search(input: { cookie: string; accountId: string; connectionId: string }, extra: Record<string, unknown> = {}) {
    return fetch(`${server.baseUrl}/api/google/accounts/${input.accountId}/matches`, { method: "POST", headers: { cookie: input.cookie, "content-type": "application/json", "x-request-id": randomUUID() }, body: JSON.stringify({ connectionId: input.connectionId, search: { kind: "query", query: "Example London" }, ...extra }) })
  }

  function draftRequest(owner: { cookie: string; accountId: string }, suffix: string, method = "GET", body?: unknown) {
    return fetch(`${server.baseUrl}/api/google/accounts/${owner.accountId}/drafts${suffix}`, { method, headers: { cookie: owner.cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
  }

  it.each(["page", "malformed", "revoked"] as const)("searches onboarding categories without a linked location: %s", async (scenario) => {
    const owner = await fixture()
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: owner.googleAccountName } }))
    let categoryCalls = 0
    google.respond({ method: "GET", pathIncludes: "/v1/categories" }, async (call) => {
      categoryCalls++
      const query = new URL(call.path, google.baseUrl).searchParams
      expect(query.get("regionCode")).toBe("GB")
      expect(query.get("languageCode")).toBe("cy")
      expect(query.get("filter")).toBe("displayName=Shop")
      expect(query.get("pageToken")).toBe("page-2")
      if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
      return { status: 200, json: scenario === "malformed" ? { error: {} } : { categories: [{ name: "categories/gcid:shop", displayName: "Shop" }], nextPageToken: "page-3" } }
    })
    const query = new URLSearchParams({ connectionId: owner.connectionId, regionCode: "GB", languageCode: "cy", query: "Shop", pageToken: "page-2" })
    const response = await fetch(`${server.baseUrl}/api/google/accounts/${owner.accountId}/categories?${query}`, { headers: { cookie: owner.cookie } })
    expect(response.status, await response.clone().text()).toBe(scenario === "page" ? 200 : scenario === "malformed" ? 502 : 404)
    if (scenario === "page") expect(await response.json()).toEqual({ categories: [{ name: "categories/gcid:shop", displayName: "Shop" }], nextPageToken: "page-3" })
    expect(categoryCalls).toBe(1)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    const other = await fixture()
    const denied = await fetch(`${server.baseUrl}/api/google/accounts/${owner.accountId}/categories?${query}`, { headers: { cookie: other.cookie } })
    expect(denied.status).toBe(404)
    expect(categoryCalls).toBe(1)
  })

  it("rejects inaccessible category searches before requesting provider categories", async () => {
    const owner = await fixture()
    const viewer = await fixture("viewer")
    google.reset()
    let categoryCalls = 0
    google.respond({ method: "GET", pathIncludes: "/v1/categories" }, () => { categoryCalls++; return { status: 200, json: {} } })
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 403, json: { error: { status: "PERMISSION_DENIED", message: "No account access" } } }))
    const query = new URLSearchParams({ connectionId: owner.connectionId, regionCode: "GB", languageCode: "en-GB", query: "Shop" })
    const endpoint = `${server.baseUrl}/api/google/accounts/${owner.accountId}/categories`
    expect((await fetch(`${endpoint}?${query}&clientId=${randomUUID()}`, { headers: { cookie: owner.cookie } })).status).toBe(404)
    expect((await fetch(`${endpoint}?${query}`, { headers: { cookie: viewer.cookie } })).status).toBe(403)
    expect((await fetch(`${endpoint}?${query}`, { headers: { cookie: owner.cookie } })).status).toBe(403)
    expect(categoryCalls).toBe(0)
  })

  async function matchedDraft(owner: Awaited<ReturnType<typeof fixture>>, matches: Array<{ name: string; location: { title: string } }> = [], details: Pick<z.infer<typeof googleOnboardingDraftSchema>["payload"], "openInfo" | "relationshipData" | "regularHours" | "specialHours" | "moreHours" | "categories"> = {}) {
    const draftId = randomUUID()
    const payload = { title: "New business", languageCode: "en-GB", storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] }, ...details }
    expect((await draftRequest(owner, "", "POST", { draftId, connectionId: owner.connectionId, payload })).status).toBe(200)
    google.reset()
    if (details.moreHours) google.respond({ method: "GET", pathIncludes: "/categories:batchGet" }, () => ({ status: 200, json: { categories: [{ name: "gcid:restaurant", moreHoursTypes: [{ hoursTypeId: "provider:delivery" }, { hoursTypeId: "provider:pickup" }] }] } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: owner.googleAccountName } }))
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: matches } }))
    const matched = await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })
    expect(matched.status, await matched.clone().text()).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await matched.json())
    return { draftId, payload, draft, input: { expectedRevision: 1, expectedMatchCheckedAt: draft.matchResult!.checkedAt, decision: { action: "create_new", acknowledgedMatchNames: matches.map((match) => match.name), reason: "This is a separate business at new premises." } } }
  }

  async function approvedDraft(owner: Awaited<ReturnType<typeof fixture>>, details: Pick<z.infer<typeof googleOnboardingDraftSchema>["payload"], "openInfo" | "relationshipData" | "regularHours" | "specialHours" | "moreHours" | "categories"> = {}) {
    const data = await matchedDraft(owner, [], details)
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, () => ({ status: 200, json: {} }))
    const response = await draftRequest(owner, `/${data.draftId}/reviews`, "POST", data.input)
    expect(response.status, await response.clone().text()).toBe(200)
    const review = googleOnboardingReviewSchema.parse(await response.json())
    const approved = await draftRequest(owner, `/${data.draftId}/reviews/${review.id}`, "POST", { expectedReviewHash: review.reviewHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    return { ...data, review, submit: { reviewId: review.id, expectedReviewHash: review.reviewHash } }
  }

  it("rejects invalid creation hours before provider access or draft persistence", async () => {
    const owner = await fixture()
    google.reset()
    const period = { openDay: "MONDAY", closeDay: "MONDAY", openTime: { hours: 9 }, closeTime: { hours: 17 } }
    for (const details of [
      { regularHours: { periods: [] } },
      { regularHours: { periods: [period, period] } },
      { regularHours: { periods: [{ ...period, openTime: { hours: 24, minutes: 1 } }] } },
      { specialHours: { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 26 }, closed: true }] } },
    ]) {
      const response = await draftRequest(owner, "", "POST", { draftId: randomUUID(), connectionId: owner.connectionId, payload: { title: "New business", languageCode: "en-GB", ...details } })
      expect(response.status, await response.clone().text()).toBe(400)
    }
    expect(google.calls).toHaveLength(0)
    expect(await admin`select id from google_onboarding_draft where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  })

  it.each(["success", "name-conflict", "readback-mismatch", "response-lost", "malformed-resource", "rejected", "opening-day-zero", "opening-day-omitted", "opening-day-invented", "relationships-reordered", "relationships-mismatch", "hours-reordered", "hours-mismatch", "special-defaults", "special-mismatch", "service-hours-reordered", "service-hours-mismatch"] as const)("creates once and recovers independently: %s", async (scenario) => {
    const owner = await fixture()
    const openingScenario = scenario.startsWith("opening-day-")
    const relationshipScenario = scenario.startsWith("relationships-")
    const hoursScenario = scenario.startsWith("hours-") || scenario.startsWith("special-")
    const regularHours = { periods: [{ openDay: "MONDAY", closeDay: "MONDAY", openTime: {}, closeTime: { hours: 12 } }, { openDay: "SATURDAY", closeDay: "SUNDAY", openTime: { hours: 22 }, closeTime: { hours: 2 } }] } satisfies NonNullable<z.infer<typeof googleOnboardingDraftSchema>["payload"]["regularHours"]>
    const specialHours = { specialHourPeriods: [{ startDate: { year: 2026, month: 12, day: 24 }, openTime: {}, closeTime: { hours: 2 } }, { startDate: { year: 2026, month: 12, day: 26 }, closed: true }] } satisfies NonNullable<z.infer<typeof googleOnboardingDraftSchema>["payload"]["specialHours"]>
    const relationshipData = { parentChain: "chains/123", parentLocation: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_child", relationType: "DEPARTMENT_OF" }, { placeId: "ChIJ_second", relationType: "INDEPENDENT_ESTABLISHMENT_IN" }] } satisfies NonNullable<z.infer<typeof googleOnboardingDraftSchema>["payload"]["relationshipData"]>
    const moreHours = [{ hoursTypeId: "provider:delivery", periods: regularHours.periods }, { hoursTypeId: "provider:pickup", periods: [regularHours.periods[0]] }]
    const data = await approvedDraft(owner, { ...(openingScenario ? { openInfo: { status: "OPEN", openingDate: { year: 2024, month: 2, ...(scenario === "opening-day-omitted" ? { day: 0 } : {}) } } } : {}), ...(relationshipScenario ? { relationshipData } : {}), ...(hoursScenario ? { regularHours, ...(scenario.startsWith("special-") ? { specialHours } : {}) } : {}), ...(scenario.startsWith("service-hours-") ? { moreHours, categories: { primaryCategory: { name: "gcid:restaurant" } } } : {}) })
    const resourceName = `locations/${randomUUID()}`
    let writes = 0
    let mismatch = scenario === "readback-mismatch"
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, (call) => {
      const query = new URL(call.path, google.baseUrl).searchParams
      expect(query.get("validateOnly")).toBe("false")
      expect(query.get("requestId")).toBe(data.draft.providerRequestId)
      expect(call.body).toEqual(data.payload)
      writes++
      if (scenario === "response-lost") return { status: 503, json: { error: { message: "Response lost after provider applied creation" } } }
      if (scenario === "rejected") return { status: 400, json: { error: { status: "INVALID_ARGUMENT", message: "Rejected" } } }
      return { status: 200, json: scenario === "malformed-resource" ? {} : { ...data.payload, name: resourceName } }
    })
    google.respond({ method: "GET", pathIncludes: `/v1/${resourceName}` }, (call) => {
      const masks = new URL(call.path, google.baseUrl).searchParams.get("readMask")?.split(",") ?? []
      if (hoursScenario) expect(masks).toEqual(expect.arrayContaining(["regularHours", "specialHours"]))
      if (scenario.startsWith("service-hours-")) {
        expect(masks).toContain("moreHours")
        return { status: 200, json: { ...data.payload, name: resourceName, metadata: { hasVoiceOfMerchant: true }, moreHours: scenario === "service-hours-mismatch" ? [moreHours[0]] : [moreHours[1], { ...moreHours[0], periods: [regularHours.periods[1], { ...regularHours.periods[0], openTime: { hours: 0, minutes: 0 } }] }] } }
      }
      return { status: 200, json: { ...data.payload, name: resourceName, title: mismatch ? "Not the approved title" : data.payload.title, metadata: { hasVoiceOfMerchant: true }, ...(openingScenario ? { openInfo: { status: "OPEN", openingDate: { year: 2024, month: 2, ...(scenario === "opening-day-omitted" ? {} : { day: scenario === "opening-day-invented" ? 1 : 0 }) } } } : {}), ...(relationshipScenario ? { relationshipData: { ...relationshipData, childrenLocations: scenario === "relationships-mismatch" ? [relationshipData.childrenLocations[0]] : [...relationshipData.childrenLocations].reverse() } } : {}), ...(hoursScenario ? { regularHours: { periods: scenario === "hours-mismatch" ? [regularHours.periods[0]] : [regularHours.periods[1], { ...regularHours.periods[0], openTime: { hours: 0, minutes: 0 } }] } } : {}), ...(scenario.startsWith("special-") ? { specialHours: { specialHourPeriods: [specialHours.specialHourPeriods[1], { ...specialHours.specialHourPeriods[0], startDate: { year: 2026, month: 12, day: scenario === "special-mismatch" ? 23 : 24 }, endDate: { year: 2026, month: 12, day: scenario === "special-mismatch" ? 23 : 24 }, closed: false, openTime: { hours: 0, minutes: 0 } }] } } : {}) } }
    })
    if (scenario === "name-conflict") await admin`insert into location (organisation_id, name) values (${owner.organisationId}, ${data.payload.title})`
    const path = `/${data.draftId}/creation`
    const responses = await Promise.all([draftRequest(owner, path, "POST", data.submit), draftRequest(owner, path, "POST", data.submit)])
    for (const response of responses) expect(response.status, await response.clone().text()).toBe(200)
    const outcomes = await Promise.all(responses.map(async (response) => googleOnboardingCreationSchema.parse(await response.json())))
    expect(outcomes[0].id).toBe(outcomes[1].id)
    expect(writes).toBe(1)
    expect((await draftRequest(owner, `/${data.draftId}`, "PUT", { expectedRevision: 1, payload: { title: "Changed" } })).status).toBe(409)
    expect((await draftRequest(owner, `/${data.draftId}/matches`, "POST", { expectedRevision: 1 })).status).toBe(409)
    let state = googleOnboardingCreationSchema.parse(await (await draftRequest(owner, path)).json())
    if (scenario === "response-lost" || scenario === "malformed-resource" || scenario === "rejected") {
      expect(state).toMatchObject({ executionState: scenario === "rejected" ? "rejected" : "unknown", confirmationState: "unresolved", providerResourceName: null, locationId: null })
      expect((await draftRequest(owner, path, "POST", data.submit)).status).toBe(200)
      expect(writes).toBe(1)
      expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      return
    }
    expect(state.providerResourceName).toBe(resourceName)
    expect(state.executionState).toBe("accepted")
    if (scenario === "opening-day-invented" || scenario === "relationships-mismatch" || scenario === "hours-mismatch" || scenario === "special-mismatch" || scenario === "service-hours-mismatch") {
      expect(state).toMatchObject({ confirmationState: "unresolved", locationId: null, errorCode: "onboarding_readback_mismatch" })
      expect(await admin`select id from location_link where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect((await draftRequest(owner, path, "POST", data.submit)).status).toBe(200)
      expect(writes).toBe(1)
      return
    }
    if (scenario === "name-conflict") {
      expect(state.linkState).toBe("failed")
      expect(state.errorCode).toBe("onboarding_local_name_conflict")
      expect(state.locationId).toBeNull()
      expect(await admin`select id from location_link where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect(await admin`select provider_resource_name from google_onboarding_creation where draft_id = ${data.draftId}`).toEqual([{ provider_resource_name: resourceName }])
    }
    if (scenario === "readback-mismatch") {
      expect(state.confirmationState).toBe("unresolved")
      expect(state.locationId).toBeNull()
      mismatch = false
    }
    const linked = await draftRequest(owner, `${path}/link`, "POST", { localName: scenario === "name-conflict" ? "New business - separate premises" : data.payload.title })
    expect(linked.status, await linked.clone().text()).toBe(200)
    state = googleOnboardingCreationSchema.parse(await linked.json())
    expect(state).toMatchObject({ confirmationState: "confirmed", linkState: "linked" })
    expect(state.locationId).not.toBeNull()
    expect(writes).toBe(1)
    expect(await admin`select id from location_link where organisation_id = ${owner.organisationId}`).toHaveLength(1)
    expect(await admin`select id from sync_checkpoint where organisation_id = ${owner.organisationId} and sync_type = 'backfill' and status = 'pending'`).toHaveLength(1)
    expect((await draftRequest(owner, path, "POST", data.submit)).status).toBe(200)
    expect(writes).toBe(1)
  }, 30_000)

  it("allows only one of two different approved reviews to claim creation", async () => {
    const owner = await fixture()
    const data = await approvedDraft(owner)
    const reviewed = await draftRequest(owner, `/${data.draftId}/reviews`, "POST", { ...data.input, decision: { ...data.input.decision, reason: "A separately reviewed decision for these premises." } })
    const second = googleOnboardingReviewSchema.parse(await reviewed.json())
    expect((await draftRequest(owner, `/${data.draftId}/reviews/${second.id}`, "POST", { expectedReviewHash: second.reviewHash })).status).toBe(200)
    const resourceName = `locations/${randomUUID()}`
    let writes = 0
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, () => { writes++; return { status: 200, json: { ...data.payload, name: resourceName } } })
    google.respond({ method: "GET", pathIncludes: `/v1/${resourceName}` }, () => ({ status: 200, json: { ...data.payload, name: resourceName } }))
    const outcomes = await Promise.all([data.submit, { reviewId: second.id, expectedReviewHash: second.reviewHash }].map((body) => draftRequest(owner, `/${data.draftId}/creation`, "POST", body)))
    expect(outcomes.map((response) => response.status).sort()).toEqual([200, 409])
    expect(writes).toBe(1)
  }, 30_000)

  it("rechecks approval policy after the last provider search and before creation", async () => {
    const owner = await fixture()
    const data = await approvedDraft(owner)
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, async () => {
      await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
      return { status: 200, json: {} }
    })
    const before = google.calls.filter((call) => call.path.includes(`/v1/${owner.googleAccountName}/locations`)).length
    const changed = await draftRequest(owner, `/${data.draftId}/creation`, "POST", data.submit)
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ error: "approval_policy_changed" })
    expect(await admin`select id from google_onboarding_creation where draft_id = ${data.draftId}`).toHaveLength(0)
    expect(google.calls.filter((call) => call.path.includes(`/v1/${owner.googleAccountName}/locations`))).toHaveLength(before)
  }, 30_000)

  it("rechecks provider matches before claiming and reports interrupted attempts without resending", async () => {
    const owner = await fixture()
    const data = await approvedDraft(owner)
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: [{ name: "googleLocations/new", location: { title: "New candidate" } }] } }))
    const path = `/${data.draftId}/creation`
    const changed = await draftRequest(owner, path, "POST", data.submit)
    expect(changed.status).toBe(409)
    expect(await changed.json()).toMatchObject({ error: "onboarding_matches_changed" })
    expect(await admin`select id from google_onboarding_creation where draft_id = ${data.draftId}`).toHaveLength(0)
    await admin`insert into google_onboarding_creation (organisation_id, draft_id, review_id, review_hash, actor_user_id, created_at) values (${owner.organisationId}, ${data.draftId}, ${data.review.id}, ${data.review.reviewHash}, ${owner.userId}, now() - interval '3 minutes')`
    const before = google.calls.length
    const interrupted = googleOnboardingCreationSchema.parse(await (await draftRequest(owner, path)).json())
    expect(interrupted).toMatchObject({ executionState: "unknown", confirmationState: "unresolved", errorCode: "onboarding_creation_interrupted" })
    expect((await draftRequest(owner, path, "POST", data.submit)).status).toBe(200)
    expect(google.calls).toHaveLength(before)
    const other = await fixture()
    expect((await draftRequest({ ...other, accountId: owner.accountId }, path)).status).toBe(404)
    await admin`update google_connection set status = 'disconnected' where id = ${owner.connectionId}`
    expect((await draftRequest(owner, `${path}/link`, "POST", { localName: "Unlinked" })).status).toBe(404)
  }, 30_000)

  it("resumes after provider-resource persistence without requiring another creation or an unexpired approval", async () => {
    const owner = await fixture()
    const data = await approvedDraft(owner)
    const resourceName = `locations/${randomUUID()}`
    await admin`insert into google_onboarding_creation (organisation_id, draft_id, review_id, review_hash, actor_user_id, execution_state, provider_resource_name) values (${owner.organisationId}, ${data.draftId}, ${data.review.id}, ${data.review.reviewHash}, ${owner.userId}, 'accepted', ${resourceName})`
    await admin`update google_onboarding_review set approval_expires_at = now() - interval '1 minute' where id = ${data.review.id}`
    google.respond({ method: "GET", pathIncludes: `/v1/${resourceName}` }, () => ({ status: 200, json: { ...data.payload, name: resourceName } }))
    const before = google.calls.filter((call) => call.method === "POST").length
    const path = `/${data.draftId}/creation`
    expect((await draftRequest(owner, path, "POST", data.submit)).status).toBe(200)
    const recovered = await draftRequest(owner, `${path}/link`, "POST", { localName: "Recovered listing" })
    expect(recovered.status, await recovered.clone().text()).toBe(200)
    expect(googleOnboardingCreationSchema.parse(await recovered.json())).toMatchObject({ executionState: "accepted", confirmationState: "confirmed", linkState: "linked", providerResourceName: resourceName })
    expect(google.calls.filter((call) => call.method === "POST")).toHaveLength(before)
  }, 30_000)

  it("validates exact creation details, freezes a review and invalidates changed approvals", async () => {
    const owner = await fixture()
    const data = await matchedDraft(owner, [{ name: "googleLocations/candidate", location: { title: "Existing similar business" } }])
    let validations = 0
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, (call) => {
      validations++
      const query = new URL(call.path, google.baseUrl).searchParams
      expect(query.get("validateOnly")).toBe("true")
      expect(query.get("requestId")).not.toBe(data.draft.providerRequestId)
      expect(call.body).toEqual(data.payload)
      return { status: 200, json: {} }
    })
    const reviewPath = `/${data.draftId}/reviews`
    expect((await draftRequest(owner, reviewPath, "POST", { ...data.input, decision: { ...data.input.decision, acknowledgedMatchNames: [] } })).status).toBe(409)
    expect(validations).toBe(0)
    const response = await draftRequest(owner, reviewPath, "POST", data.input)
    expect(response.status, await response.clone().text()).toBe(200)
    const review = googleOnboardingReviewSchema.parse(await response.json())
    expect(review).toMatchObject({ payload: data.payload, providerRequestId: data.draft.providerRequestId, approvedBy: null, matchResult: data.draft.matchResult })
    const unapproved = await draftRequest(owner, `/${data.draftId}/creation`, "POST", { reviewId: review.id, expectedReviewHash: review.reviewHash })
    expect(unapproved.status).toBe(409)
    expect(await unapproved.json()).toMatchObject({ error: "approval_required" })
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    try {
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`
        await sql`update google_onboarding_review set frozen = '{}'::jsonb where id = ${review.id}`
      })).rejects.toMatchObject({ code: "42501" })
    } finally { await runtime.end() }
    expect((await draftRequest(owner, `${reviewPath}/${review.id}`, "POST", { expectedReviewHash: "0".repeat(64) })).status).toBe(409)
    const approved = await draftRequest(owner, `${reviewPath}/${review.id}`, "POST", { expectedReviewHash: review.reviewHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(googleOnboardingReviewSchema.parse(await approved.json()).approvedBy).toBe(owner.userId)
    expect(googleOnboardingReviewSchema.parse(await (await draftRequest(owner, `${reviewPath}/${review.id}`)).json()).approvedBy).toBe(owner.userId)
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    expect((await draftRequest(owner, `${reviewPath}/${review.id}`)).status).toBe(409)
    await admin`update organisation set require_two_person_approval = false where id = ${owner.organisationId}`
    expect((await draftRequest(owner, `/${data.draftId}`, "PUT", { expectedRevision: 1, payload: { ...data.payload, title: "Changed business" } })).status).toBe(200)
    expect((await draftRequest(owner, `${reviewPath}/${review.id}`, "POST", { expectedReviewHash: review.reviewHash })).status).toBe(409)
    expect(validations).toBe(1)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  }, 30_000)

  it("blocks review validation while listing writes are paused", async () => {
    const owner = await fixture()
    const data = await matchedDraft(owner)
    const before = google.calls.length
    const paused = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL!, PUBLISH_ENABLED: "false", GBP_PROFILE_WRITES_ENABLED: "true" })
    try {
      const response = await fetch(`${paused.baseUrl}/api/google/accounts/${owner.accountId}/drafts/${data.draftId}/reviews`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify(data.input) })
      expect(response.status).toBe(503)
      expect(await response.json()).toMatchObject({ error: "google_writes_paused" })
      expect(google.calls).toHaveLength(before)
      expect(await admin`select id from google_onboarding_review where draft_id = ${data.draftId}`).toHaveLength(0)
    } finally { await paused.stop() }
  }, 30_000)

  it("enforces a second approver, tenant isolation, expiry and current approver access", async () => {
    const owner = await fixture()
    const second = await fixture()
    await admin`insert into member (organisation_id, user_id, role, can_publish) values (${owner.organisationId}, ${second.userId}, 'admin', true)`
    await admin`update app_session set organisation_id = ${owner.organisationId} where user_id = ${second.userId}`
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    const data = await matchedDraft(owner)
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, () => ({ status: 200, json: {} }))
    const reviewed = await draftRequest(owner, `/${data.draftId}/reviews`, "POST", data.input)
    expect(reviewed.status, await reviewed.clone().text()).toBe(200)
    const review = googleOnboardingReviewSchema.parse(await reviewed.json())
    const path = `/${data.draftId}/reviews/${review.id}`
    expect(review.canApprove).toBe(false)
    const self = await draftRequest(owner, path, "POST", { expectedReviewHash: review.reviewHash })
    expect(self.status).toBe(409)
    expect(await self.json()).toMatchObject({ error: "second_approver_required" })
    const other = await fixture()
    expect((await draftRequest({ ...other, accountId: owner.accountId }, path)).status).toBe(404)
    const approver = { ...owner, cookie: second.cookie }
    const approved = await draftRequest(approver, path, "POST", { expectedReviewHash: review.reviewHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(googleOnboardingReviewSchema.parse(await approved.json()).approvedBy).toBe(second.userId)
    await admin`update member set role = 'viewer' where organisation_id = ${owner.organisationId} and user_id = ${second.userId}`
    const revoked = await draftRequest(owner, path)
    expect(revoked.status).toBe(409)
    expect(await revoked.json()).toMatchObject({ error: "approval_actor_access_changed" })
    await admin`update member set role = 'admin' where organisation_id = ${owner.organisationId} and user_id = ${second.userId}`
    await admin`update google_onboarding_review set approval_expires_at = now() - interval '1 minute' where id = ${review.id}`
    const expired = await draftRequest(owner, path)
    expect(expired.status).toBe(409)
    expect(await expired.json()).toMatchObject({ error: "approval_expired" })
    expect(google.calls.filter((call) => call.path.includes("/locations?")).every((call) => new URL(call.path, google.baseUrl).searchParams.get("validateOnly") === "true")).toBe(true)
  }, 30_000)

  it("does not save reviews after rejected validation, mid-validation edits or rematching", async () => {
    const owner = await fixture()
    const data = await matchedDraft(owner)
    let mode: "reject" | "malformed" | "success" | "edit" = "reject"
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations` }, async () => {
      if (mode === "reject") return { status: 400, json: { error: { code: 400, status: "INVALID_ARGUMENT", message: "Address not accepted" } } }
      if (mode === "malformed") return { status: 200, json: { error: "Validation failed" } }
      if (mode === "edit") expect((await draftRequest(owner, `/${data.draftId}`, "PUT", { expectedRevision: 1, payload: { ...data.payload, title: "Edited during validation" } })).status).toBe(200)
      return { status: 200, json: {} }
    })
    const path = `/${data.draftId}/reviews`
    expect((await draftRequest(owner, path, "POST", data.input)).status).toBeGreaterThanOrEqual(400)
    expect(await admin`select id from google_onboarding_review where draft_id = ${data.draftId}`).toHaveLength(0)
    mode = "malformed"
    const malformed = await draftRequest(owner, path, "POST", data.input)
    expect(malformed.status).toBe(502)
    expect(await malformed.json()).toMatchObject({ error: "onboarding_validation_unconfirmed" })
    expect(await admin`select id from google_onboarding_review where draft_id = ${data.draftId}`).toHaveLength(0)
    mode = "success"
    const review = googleOnboardingReviewSchema.parse(await (await draftRequest(owner, path, "POST", data.input)).json())
    const rematched = await draftRequest(owner, `/${data.draftId}/matches`, "POST", { expectedRevision: 1 })
    expect(rematched.status).toBe(200)
    expect((await draftRequest(owner, `${path}/${review.id}`, "POST", { expectedReviewHash: review.reviewHash })).status).toBe(409)
    const refreshed = googleOnboardingDraftSchema.parse(await rematched.json())
    mode = "edit"
    const stale = await draftRequest(owner, path, "POST", { ...data.input, expectedMatchCheckedAt: refreshed.matchResult!.checkedAt })
    expect(stale.status).toBe(409)
    expect(await admin`select id from google_onboarding_review where draft_id = ${data.draftId}`).toHaveLength(1)
  }, 30_000)

  it("lists only active drafts for the selected client and connection", async () => {
    const owner = await fixture()
    const other = await fixture()
    const clientIds = [randomUUID(), randomUUID()]
    for (const clientId of clientIds) {
      await admin`insert into client (id, organisation_id, name, slug) values (${clientId}, ${owner.organisationId}, ${`Draft client ${clientId}`}, ${clientId})`
      await admin`insert into client_google_connection (organisation_id, client_id, google_connection_id) values (${owner.organisationId}, ${clientId}, ${owner.connectionId})`
      expect((await draftRequest(owner, "", "POST", { draftId: randomUUID(), connectionId: owner.connectionId, clientId, payload: { title: `Business ${clientId}` } })).status).toBe(200)
    }
    const list = await draftRequest(owner, `?connectionId=${owner.connectionId}&clientId=${clientIds[0]}`)
    expect(list.status).toBe(200)
    const result: { drafts: unknown[] } = await list.json()
    expect(result.drafts).toHaveLength(1)
    const draft = googleOnboardingDraftSchema.parse(result.drafts[0])
    expect(draft.clientId).toBe(clientIds[0])
    const unassigned = await draftRequest(owner, `?connectionId=${owner.connectionId}`)
    expect(await unassigned.json()).toEqual({ drafts: [] })
    expect((await draftRequest(owner, `?connectionId=${other.connectionId}`)).status).toBe(404)
    expect((await draftRequest({ ...other, accountId: owner.accountId }, `?connectionId=${owner.connectionId}&clientId=${clientIds[0]}`)).status).toBe(404)
    await admin`update google_onboarding_draft set expires_at = now() - interval '1 day' where id = ${draft.id}`
    expect(await (await draftRequest(owner, `?connectionId=${owner.connectionId}&clientId=${clientIds[0]}`)).json()).toEqual({ drafts: [] })
  }, 30_000)

  it("persists zero-location drafts with retry identity, revision conflicts and tenant isolation", async () => {
    const owner = await fixture()
    const other = await fixture()
    const viewer = await fixture("viewer")
    const draftId = randomUUID()
    const input = { draftId, connectionId: owner.connectionId, payload: { title: "Draft business", languageCode: "en-GB" } }
    google.reset()
    const creates = await Promise.all([draftRequest(owner, "", "POST", input), draftRequest(owner, "", "POST", input)])
    for (const response of creates) expect(response.status, await response.clone().text()).toBe(200)
    const first = googleOnboardingDraftSchema.parse(await creates[0].json())
    expect(googleOnboardingDraftSchema.parse(await creates[1].json())).toEqual(first)
    expect(first).toMatchObject({ revision: 1, payload: input.payload, matchResult: null })
    const separate = await draftRequest(owner, "", "POST", { ...input, draftId: randomUUID() })
    expect(googleOnboardingDraftSchema.parse(await separate.json()).providerRequestId).not.toBe(first.providerRequestId)
    const saves = await Promise.all(["Changed A", "Changed B"].map((title) => draftRequest(owner, `/${draftId}`, "PUT", { expectedRevision: 1, payload: { title } })))
    expect(saves.map((response) => response.status).sort()).toEqual([200, 409])
    const restored = googleOnboardingDraftSchema.parse(await (await draftRequest(owner, `/${draftId}`)).json())
    expect(restored.revision).toBe(2)
    expect(restored.providerRequestId).toBe(first.providerRequestId)
    expect((await draftRequest(owner, "", "POST", input)).status).toBe(409)
    expect((await draftRequest({ ...other, accountId: owner.accountId }, `/${draftId}`)).status).toBe(404)
    expect((await draftRequest({ ...viewer, accountId: owner.accountId }, `/${draftId}`)).status).toBe(403)
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL!, { max: 1 })
    try {
      await runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${other.organisationId}, true)`
        expect(await sql`select id from google_onboarding_draft where id = ${draftId}`).toHaveLength(0)
      })
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`
        await sql`update google_onboarding_draft set provider_request_id = ${randomUUID()} where id = ${draftId}`
      })).rejects.toMatchObject({ code: "42501" })
    } finally { await runtime.end() }
    await admin`update google_connection set status = 'disconnected' where id = ${owner.connectionId}`
    expect((await draftRequest(owner, `/${draftId}`)).status).toBe(404)
    expect(google.calls).toHaveLength(0)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  }, 30_000)

  it("stores server-observed matches for the saved revision and rejects late results", async () => {
    const owner = await fixture()
    const draftId = randomUUID()
    const created = await draftRequest(owner, "", "POST", { draftId, connectionId: owner.connectionId, payload: { title: "Saved business", languageCode: "en-GB" } })
    expect(created.status, await created.clone().text()).toBe(200)
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: owner.googleAccountName } }))
    let editDuringSearch = false
    let supersedeSearch = false
    let failSearch = false
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, async (call) => {
      expect(call.body).toEqual({ location: { title: "Saved business" }, pageSize: 10 })
      if (supersedeSearch) {
        supersedeSearch = false
        failSearch = true
        expect((await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })).status).toBe(502)
        failSearch = false
      }
      if (editDuringSearch) {
        const save = await draftRequest(owner, `/${draftId}`, "PUT", { expectedRevision: 1, payload: { title: "New business details" } })
        expect(save.status).toBe(200)
      }
      return { status: 200, json: failSearch ? { googleLocations: null } : {} }
    })
    const matched = await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })
    expect(matched.status, await matched.clone().text()).toBe(200)
    expect(googleOnboardingDraftSchema.parse(await matched.json()).matchResult?.matches).toEqual([])
    failSearch = true
    expect((await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })).status).toBe(502)
    expect(googleOnboardingDraftSchema.parse(await (await draftRequest(owner, `/${draftId}`)).json()).matchResult).toBeNull()
    failSearch = false
    supersedeSearch = true
    const superseded = await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })
    expect(superseded.status).toBe(409)
    expect(await superseded.json()).toMatchObject({ error: "onboarding_match_superseded" })
    expect(googleOnboardingDraftSchema.parse(await (await draftRequest(owner, `/${draftId}`)).json()).matchResult).toBeNull()
    editDuringSearch = true
    expect((await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })).status).toBe(409)
    const restored = googleOnboardingDraftSchema.parse(await (await draftRequest(owner, `/${draftId}`)).json())
    expect(restored).toMatchObject({ revision: 2, payload: { title: "New business details" }, matchResult: null })
    const before = google.calls.length
    expect((await draftRequest(owner, `/${draftId}/matches`, "POST", { expectedRevision: 1 })).status).toBe(409)
    expect(google.calls).toHaveLength(before)
    await admin`update google_onboarding_draft set expires_at = now() - interval '1 day' where id = ${draftId}`
    expect((await draftRequest(owner, `/${draftId}`)).status).toBe(404)
  }, 30_000)

  it("searches with zero locations and keeps claimed, unclaimed and empty results distinct", async () => {
    const owner = await fixture()
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: owner.googleAccountName } }))
    let empty = false
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, (call) => {
      expect(call.body).toEqual({ query: "Example London", pageSize: 10 })
      return { status: 200, json: empty ? {} : { googleLocations: [
        { name: "googleLocations/claimed", location: { title: "Claimed business" }, requestAdminRightsUri: "https://business.google.com/request" },
        { name: "googleLocations/unclaimed", location: { title: "Potential match", storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } } },
      ] } }
    })
    const response = await search(owner)
    expect(response.status, await response.clone().text()).toBe(200)
    const result = googleAccountMatchesResponseSchema.parse(await response.json())
    expect(result).toMatchObject({ accountId: owner.accountId, connectionId: owner.connectionId })
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]?.requestAdminRightsUri).toBe("https://business.google.com/request")
    expect(result.matches[1]?.requestAdminRightsUri).toBeUndefined()
    const clientId = randomUUID()
    await admin`insert into client (id, organisation_id, name, slug) values (${clientId}, ${owner.organisationId}, 'Connected client', ${`connected-${clientId}`})`
    await admin`insert into client_google_connection (organisation_id, client_id, google_connection_id) values (${owner.organisationId}, ${clientId}, ${owner.connectionId})`
    const scoped = await search(owner, { clientId })
    expect(scoped.status, await scoped.clone().text()).toBe(200)
    expect(googleAccountMatchesResponseSchema.parse(await scoped.json()).matches).toHaveLength(2)
    empty = true
    const none = await search(owner)
    expect(none.status).toBe(200)
    expect(googleAccountMatchesResponseSchema.parse(await none.json()).matches).toEqual([])
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from external_location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from gbp_management_mutation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(google.calls.every((call) => call.method === "GET" || call.path.includes("googleLocations:search"))).toBe(true)
  }, 30_000)

  it("rejects cross-tenant, mismatched connection, client scope and viewer requests before Google", async () => {
    const owner = await fixture()
    const other = await fixture()
    const viewer = await fixture("viewer")
    const clientId = randomUUID()
    await admin`insert into client (id, organisation_id, name, slug) values (${clientId}, ${owner.organisationId}, 'Unconnected client', ${`unconnected-${clientId}`})`
    google.reset()
    expect((await search({ ...owner, accountId: other.accountId })).status).toBe(404)
    expect((await search({ ...owner, connectionId: other.connectionId })).status).toBe(404)
    expect((await search(owner, { clientId })).status).toBe(404)
    expect((await search(viewer)).status).toBe(403)
    await admin`update google_connection set status = 'disconnected' where id = ${owner.connectionId}`
    expect((await search(owner)).status).toBe(404)
    expect(google.calls).toHaveLength(0)
  }, 30_000)

  it("does not convert malformed provider results or account denial into no matches", async () => {
    const owner = await fixture()
    google.reset()
    let denied = false
    let mismatchedAccount = true
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => denied ? { status: 403, json: { error: { code: 403, status: "PERMISSION_DENIED", message: "No account access" } } } : { status: 200, json: { name: mismatchedAccount ? "accounts/different" : owner.googleAccountName } })
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: [{ name: "bad", location: {} }] } }))
    const mismatch = await search(owner)
    expect(mismatch.status).toBe(502)
    expect(await mismatch.json()).toMatchObject({ error: "onboarding_account_unconfirmed" })
    expect(google.calls.filter((call) => call.path.includes("googleLocations:search"))).toHaveLength(0)
    mismatchedAccount = false
    const malformed = await search(owner)
    expect(malformed.status).toBe(502)
    expect(await malformed.json()).toMatchObject({ error: "google_matches_invalid" })
    const count = google.calls.filter((call) => call.path.includes("googleLocations:search")).length
    denied = true
    const rejected = await search(owner)
    expect(rejected.status).toBeGreaterThanOrEqual(400)
    expect(google.calls.filter((call) => call.path.includes("googleLocations:search"))).toHaveLength(count)
  }, 30_000)

  it("rechecks connection access before returning search data", async () => {
    const owner = await fixture()
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: owner.googleAccountName } }))
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, async () => {
      await admin`update google_connection set status = 'disconnected' where id = ${owner.connectionId}`
      return { status: 200, json: { googleLocations: [{ name: "googleLocations/match", location: { title: "Do not return" } }] } }
    })
    const response = await search(owner)
    expect(response.status).toBe(404)
    expect(await response.text()).not.toContain("Do not return")
  }, 30_000)
})
