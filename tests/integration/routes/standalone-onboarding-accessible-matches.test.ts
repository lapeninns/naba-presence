import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { googleOnboardingDraftSchema } from "@/lib/contracts/google-onboarding"
import { onboardingAccessibleMatchesResponseSchema } from "@/lib/contracts/google-onboarding-accessible-matches"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection } from "../helpers/tenant"

const database = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

database("standalone accessible onboarding matches", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GOOGLE_REQUESTS_PER_SECOND: "100", DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL ?? "", DATABASE_POOL_MAX: "1" })
  })
  afterAll(async () => {
    await server.stop()
    await google.stop()
    await destroyTenants(admin, organisations)
    await admin.end()
  })

  async function fixture() {
    const owner = await createTestTenant(admin)
    organisations.push(owner.organisationId)
    const connection = await seedGoogleConnection(admin, { organisationId: owner.organisationId })
    const [account] = await admin<{ id: string }[]>`select id::text from google_account where organisation_id = ${owner.organisationId}`
    if (!account) throw new Error("Missing fixture account")
    const draftId = randomUUID()
    const path = `/api/google/accounts/${account.id}/drafts/${draftId}`
    const created = await fetch(`${server.baseUrl}/api/google/accounts/${account.id}/drafts`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId, connectionId: connection.connectionId, payload: { title: "Existing business", languageCode: "en", storefrontAddress: { regionCode: "GB", addressLines: ["1 Test Street"] } } }) })
    expect(created.status, await created.clone().text()).toBe(200)
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}` }, () => ({ status: 200, json: { name: connection.googleAccountName } }))
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: [{ name: "googleLocations/search-id", location: { title: "Existing business", metadata: { placeId: "place:exact" } }, requestAdminRightsUri: "https://business.google.com/ownership" }] } }))
    const matched = await fetch(`${server.baseUrl}${path}/matches`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) })
    expect(matched.status, await matched.clone().text()).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await matched.json())
    if (!draft.matchResult) throw new Error("Missing fixture matches")
    return { ...owner, ...connection, path, draft, checkedAt: draft.matchResult.checkedAt }
  }

  function load(owner: Awaited<ReturnType<typeof fixture>>, cookie = owner.cookie, revision = 1, checkedAt = owner.checkedAt) {
    const query = new URLSearchParams({ expectedRevision: String(revision), expectedMatchCheckedAt: checkedAt })
    return fetch(`${server.baseUrl}${owner.path}/accessible-matches?${query}`, { headers: { cookie } })
  }

  async function claimCreation(owner: Awaited<ReturnType<typeof fixture>>) {
    const reviewId = randomUUID()
    await admin`insert into google_onboarding_review (id, organisation_id, draft_id, revision, match_request_id, frozen, review_hash, requested_by, require_two_person_approval, validation_request_id, validation_response)
      values (${reviewId}, ${owner.organisationId}, ${owner.draft.id}, 1, ${randomUUID()}, '{}'::jsonb, ${"a".repeat(64)}, ${owner.userId}, false, ${randomUUID()}, '{}'::jsonb)`
    await admin`insert into google_onboarding_creation (organisation_id, draft_id, review_id, review_hash, actor_user_id)
      values (${owner.organisationId}, ${owner.draft.id}, ${reviewId}, ${"a".repeat(64)}, ${owner.userId})`
  }

  it("finds an exact place match on a later account page when there are zero local listings", async () => {
    const owner = await fixture()
    const pages: (string | null)[] = []
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, (call) => {
      const query = new URL(call.path, google.baseUrl).searchParams
      pages.push(query.get("pageToken"))
      expect(query.get("pageSize")).toBe("100")
      return { status: 200, json: query.has("pageToken") ? { locations: [{ name: "locations/exact", title: "Authorised title", metadata: { placeId: "place:exact" } }] } : { locations: [{ name: "locations/unrelated", title: "Existing business" }], nextPageToken: "page-2" } }
    })
    const response = await load(owner)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(onboardingAccessibleMatchesResponseSchema.parse(await response.json())).toMatchObject({ draftId: owner.draft.id, revision: 1, payloadHash: owner.draft.payloadHash, matchCheckedAt: owner.checkedAt, matches: [{ matchName: "googleLocations/search-id", status: "accessible", location: { name: "locations/exact", title: "Authorised title", placeId: "place:exact" } }] })
    expect(pages).toEqual([null, "page-2"])
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from google_onboarding_creation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(google.calls.filter((call) => call.method !== "GET" && !call.path.includes("googleLocations:search"))).toHaveLength(0)
  })

  it.each(["empty", "ambiguous", "malformed", "duplicate", "loop", "limit", "edited", "rematched", "revoked", "creation-started"] as const)("preserves discovery truth when account listing is %s", async (scenario) => {
    const owner = await fixture()
    let page = 0
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, async () => {
      page++
      if (scenario === "edited") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
      if (scenario === "rematched") await admin`update google_onboarding_draft set match_request_id = ${randomUUID()} where id = ${owner.draft.id}`
      if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
      if (scenario === "creation-started") await claimCreation(owner)
      return { status: 200, json: scenario === "malformed" ? { locations: null } : scenario === "limit" ? { nextPageToken: `page-${page}` } : scenario === "loop" ? { nextPageToken: "repeat" } : scenario === "duplicate" || scenario === "ambiguous" ? { locations: [{ name: "locations/one", metadata: { placeId: "place:exact" } }, { name: scenario === "duplicate" ? "locations/one" : "locations/two", metadata: { placeId: "place:exact" } }] } : {} }
    })
    const response = await load(owner)
    expect(response.status, await response.clone().text()).toBe(scenario === "malformed" || scenario === "duplicate" || scenario === "loop" || scenario === "limit" ? 502 : scenario === "edited" || scenario === "rematched" || scenario === "creation-started" ? 409 : scenario === "revoked" ? 404 : 200)
    if (response.ok) expect(onboardingAccessibleMatchesResponseSchema.parse(await response.json()).matches[0]?.status).toBe(scenario === "ambiguous" ? "ambiguous" : "not_accessible")
    if (scenario === "limit") expect(page).toBe(100)
  }, 15_000)

  it.each(["stale", "superseded", "expired", "missing", "cross-tenant", "viewer", "account-unconfirmed", "creation-started", "revoked"] as const)("rejects discovery before listing when scope is %s", async (scenario) => {
    const owner = await fixture()
    let calls = 0
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, () => { calls++; return { status: 200, json: {} } })
    if (scenario === "missing") await admin`update google_onboarding_draft set match_result = null where id = ${owner.draft.id}`
    if (scenario === "creation-started") await claimCreation(owner)
    if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
    if (scenario === "expired") await admin`update google_onboarding_draft set match_result = jsonb_set(match_result, '{checkedAt}', to_jsonb('2020-01-01T00:00:00.000Z'::text)) where id = ${owner.draft.id}`
    if (scenario === "account-unconfirmed") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: 200, json: { name: "accounts/other" } }))
    const other = scenario === "cross-tenant" || scenario === "viewer" ? await createTestTenant(admin, { role: scenario === "viewer" ? "viewer" : "owner" }) : null
    if (other) organisations.push(other.organisationId)
    const response = await load(owner, other?.cookie ?? owner.cookie, scenario === "stale" ? 2 : 1, scenario === "superseded" ? "2020-01-01T00:00:00.000Z" : scenario === "expired" ? "2020-01-01T00:00:00.000Z" : owner.checkedAt)
    expect(response.status, await response.clone().text()).toBe(scenario === "cross-tenant" || scenario === "revoked" ? 404 : scenario === "viewer" ? 403 : scenario === "account-unconfirmed" ? 502 : 409)
    expect(calls).toBe(0)
  })
})
