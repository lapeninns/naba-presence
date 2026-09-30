import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { googleOnboardingDraftSchema, googleOnboardingReviewSchema } from "@/lib/contracts/google-onboarding"
import { onboardingMatchLinkOperationSchema, onboardingMatchLinkReviewSchema } from "@/lib/contracts/google-onboarding-match-link"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection, seedMemberUser } from "../helpers/tenant"

const database = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

database("standalone exact match-link reviews", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  function bootServer() {
    return startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, GOOGLE_REQUESTS_PER_SECOND: "100", DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL ?? "", DATABASE_POOL_MAX: "1", PUBLISH_ENABLED: "true", GBP_PROFILE_WRITES_ENABLED: "true" })
  }
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await bootServer()
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
    const response = await fetch(`${server.baseUrl}/api/google/accounts/${account.id}/drafts`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId, connectionId: connection.connectionId, payload: { title: "Proposed business", languageCode: "en-GB" } }) })
    expect(response.status, await response.clone().text()).toBe(200)
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}` }, () => ({ status: 200, json: { name: connection.googleAccountName } }))
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, () => ({ status: 200, json: { googleLocations: [{ name: "googleLocations/search", location: { metadata: { placeId: "place:exact" } } }] } }))
    const matched = await fetch(`${server.baseUrl}${path}/matches`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1 }) })
    expect(matched.status, await matched.clone().text()).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await matched.json())
    if (!draft.matchResult) throw new Error("Missing fixture matches")
    const providerName = `locations/${randomUUID()}`
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}/locations?` }, () => ({ status: 200, json: { locations: [{ name: providerName, title: "Provider business", metadata: { placeId: "place:exact" } }] } }))
    google.respond({ method: "GET", pathIncludes: `/v1/${providerName}?` }, () => ({ status: 200, json: { name: providerName, title: "Provider business", metadata: { placeId: "place:exact" }, storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] } } }))
    return { ...owner, ...connection, path, draft, providerName, input: { expectedRevision: 1, expectedMatchCheckedAt: draft.matchResult.checkedAt, matchName: "googleLocations/search", localName: "New local mapping" } }
  }

  function request(owner: Awaited<ReturnType<typeof fixture>>, suffix = "", body: unknown = owner.input, cookie = owner.cookie, method = "POST") {
    return fetch(`${server.baseUrl}${owner.path}/match-link-reviews${suffix}`, { method, headers: { cookie, "content-type": "application/json" }, ...(method === "GET" ? {} : { body: JSON.stringify(body) }) })
  }

  async function review(owner: Awaited<ReturnType<typeof fixture>>) {
    const response = await request(owner)
    expect(response.status, await response.clone().text()).toBe(200)
    return onboardingMatchLinkReviewSchema.parse(await response.json())
  }

  async function approvedReview(owner: Awaited<ReturnType<typeof fixture>>) {
    const saved = await review(owner)
    const approved = await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    return onboardingMatchLinkReviewSchema.parse(await approved.json())
  }

  function operation(owner: Awaited<ReturnType<typeof fixture>>, saved?: Awaited<ReturnType<typeof approvedReview>>, cookie = owner.cookie) {
    return fetch(`${server.baseUrl}${owner.path}/match-link`, { method: saved ? "POST" : "GET", headers: { cookie, "content-type": "application/json" }, ...(saved ? { body: JSON.stringify({ reviewId: saved.id, expectedReviewHash: saved.reviewHash }) } : {}) })
  }

  async function creationReview(owner: Awaited<ReturnType<typeof fixture>>) {
    const response = await fetch(`${server.baseUrl}${owner.path}/reviews`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedRevision: 1, expectedMatchCheckedAt: owner.input.expectedMatchCheckedAt, decision: { action: "create_new", acknowledgedMatchNames: [owner.input.matchName], reason: "Separate fixture business for race coverage" } }) })
    expect(response.status, await response.clone().text()).toBe(200)
    const saved = googleOnboardingReviewSchema.parse(await response.json())
    const approved = await fetch(`${server.baseUrl}${owner.path}/reviews/${saved.id}`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ expectedReviewHash: saved.reviewHash }) })
    expect(approved.status, await approved.clone().text()).toBe(200)
    return saved
  }

  it("persists an exact local mapping review and approval when no local listings exist", async () => {
    const owner = await fixture()
    const saved = await review(owner)
    expect(saved).toMatchObject({ draftId: owner.draft.id, payloadHash: owner.draft.payloadHash, accountName: owner.googleAccountName, connectionId: owner.connectionId, clientId: null, matchName: "googleLocations/search", localName: owner.input.localName, conflicts: [], externalLocationId: null, approvedBy: null, provider: { name: owner.providerName, title: "Provider business", placeId: "place:exact", verified: null } })
    const restored = await request(owner, `/${saved.id}`, undefined, owner.cookie, "GET")
    expect(restored.status).toBe(200)
    expect(onboardingMatchLinkReviewSchema.parse(await restored.json())).toEqual(saved)
    const approved = await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash })
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(onboardingMatchLinkReviewSchema.parse(await approved.json()).approvedBy).toBe(owner.userId)
    const repeated = await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash })
    expect(repeated.status).toBe(200)
    expect(await admin`select id from google_onboarding_match_link_review where organisation_id = ${owner.organisationId}`).toHaveLength(1)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from google_onboarding_creation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(google.calls.filter((call) => call.method !== "GET" && !call.path.includes("googleLocations:search"))).toHaveLength(0)
  })

  it.each([false, true])("preserves explicit Google verification when it is %s", async (verified) => {
    const owner = await fixture()
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, () => ({ status: 200, json: { name: owner.providerName, title: "Provider business", metadata: { placeId: "place:exact", hasVoiceOfMerchant: verified } } }))
    const saved = await review(owner)
    expect(saved.provider.verified).toBe(verified)
  })

  it.each(["local_name", "external_assignment", "existing_link", "webhook_assignment"] as const)("shows a blocked concrete review when %s conflicts with the proposed mapping", async (conflict) => {
    const owner = await fixture()
    if (conflict === "local_name") await admin`insert into location (organisation_id, name) values (${owner.organisationId}, ${owner.input.localName})`
    else {
      const externalId = randomUUID()
      await admin`insert into external_location (id, organisation_id, google_connection_id, google_account_name, google_location_name, title) values (${externalId}, ${owner.organisationId}, ${owner.connectionId}, ${conflict === "external_assignment" ? "accounts/other" : owner.googleAccountName}, ${owner.providerName}, 'Existing mapping')`
      if (conflict === "existing_link") {
        const locationId = randomUUID()
        await admin`insert into location (id, organisation_id, name) values (${locationId}, ${owner.organisationId}, 'Prior local mapping')`
        await admin`insert into location_link (organisation_id, location_id, external_location_id, is_active) values (${owner.organisationId}, ${locationId}, ${externalId}, false)`
      }
      if (conflict === "webhook_assignment") {
        const other = await createTestTenant(admin)
        organisations.push(other.organisationId)
        const otherConnection = await seedGoogleConnection(admin, { organisationId: other.organisationId })
        const otherExternal = randomUUID()
        await admin`insert into external_location (id, organisation_id, google_connection_id, google_account_name, google_location_name, title) values (${otherExternal}, ${other.organisationId}, ${otherConnection.connectionId}, ${otherConnection.googleAccountName}, ${owner.providerName}, 'Hidden other tenant')`
        await admin`insert into webhook_route (google_location_name, organisation_id, external_location_id) values (${owner.providerName}, ${other.organisationId}, ${otherExternal})`
      }
    }
    const saved = await review(owner)
    expect(saved.conflicts).toEqual([conflict])
    expect(saved.canApprove).toBe(false)
    const response = await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash })
    expect(response.status).toBe(409)
    expect((await response.json()).error).toBe("onboarding_match_link_conflict")
  })

  it.each(["provider-changed", "identity-changed", "access-lost", "edited", "rematched", "revoked", "policy-changed", "expired", "actor-demoted", "mapping-changed", "hash-changed", "during-approval-edit", "during-approval-policy", "during-approval-mapping"] as const)("rejects obsolete approval when %s changes after review", async (scenario) => {
    const owner = await fixture()
    const saved = await review(owner)
    if (scenario === "provider-changed" || scenario === "identity-changed") google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, () => ({ status: 200, json: { name: owner.providerName, title: scenario === "provider-changed" ? "Changed business" : "Provider business", metadata: { placeId: scenario === "identity-changed" ? "place:other" : "place:exact" } } }))
    if (scenario === "access-lost") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, () => ({ status: 200, json: {} }))
    if (scenario === "edited") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
    if (scenario === "rematched") await admin`update google_onboarding_draft set match_request_id = ${randomUUID()} where id = ${owner.draft.id}`
    if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
    if (scenario === "policy-changed") await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    if (scenario === "expired") await admin`update google_onboarding_match_link_review set approval_expires_at = now() - interval '1 second' where id = ${saved.id}`
    if (scenario === "actor-demoted") {
      const manager = await seedMemberUser(admin, { organisationId: owner.organisationId })
      await admin`update member set role = 'admin' where user_id = ${manager.userId}`
      await admin`update google_onboarding_match_link_review set requested_by = ${manager.userId} where id = ${saved.id}`
      await admin`update member set role = 'member' where user_id = ${manager.userId}`
    }
    if (scenario === "mapping-changed") await admin`insert into location (organisation_id, name) values (${owner.organisationId}, ${owner.input.localName})`
    if (scenario === "during-approval-edit" || scenario === "during-approval-policy" || scenario === "during-approval-mapping") google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, async () => {
      if (scenario === "during-approval-edit") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
      if (scenario === "during-approval-policy") await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
      if (scenario === "during-approval-mapping") await admin`insert into location (organisation_id, name) values (${owner.organisationId}, ${owner.input.localName})`
      return { status: 200, json: { name: owner.providerName, title: "Provider business", metadata: { placeId: "place:exact" }, storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] } } }
    })
    const response = await request(owner, `/${saved.id}`, { expectedReviewHash: scenario === "hash-changed" ? "b".repeat(64) : saved.reviewHash })
    expect(response.status, await response.clone().text()).toBe(scenario === "identity-changed" ? 502 : scenario === "revoked" ? 404 : 409)
    const [row] = await admin<{ approved_by: string | null }[]>`select approved_by from google_onboarding_match_link_review where id = ${saved.id}`
    expect(row?.approved_by).toBeNull()
  })

  it("requires a different current manager when two-person approval is enabled", async () => {
    const owner = await fixture()
    await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    const second = await seedMemberUser(admin, { organisationId: owner.organisationId })
    await admin`update member set role = 'admin' where user_id = ${second.userId}`
    const saved = await review(owner)
    expect(saved.requiresSecondApprover).toBe(true)
    expect((await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash })).status).toBe(409)
    const approved = await request(owner, `/${saved.id}`, { expectedReviewHash: saved.reviewHash }, second.cookie)
    expect(approved.status, await approved.clone().text()).toBe(200)
    expect(onboardingMatchLinkReviewSchema.parse(await approved.json()).approvedBy).toBe(second.userId)
  })

  it.each(["cross-tenant", "viewer", "inaccessible", "ambiguous", "identity-unconfirmed", "concurrent-edit", "concurrent-rematch"] as const)("creates no review when %s prevents trustworthy selection", async (scenario) => {
    const owner = await fixture()
    const other = scenario === "cross-tenant" || scenario === "viewer" ? await createTestTenant(admin, { role: scenario === "viewer" ? "viewer" : "owner" }) : null
    if (other) organisations.push(other.organisationId)
    if (scenario === "inaccessible" || scenario === "ambiguous") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, () => ({ status: 200, json: scenario === "inaccessible" ? {} : { locations: [{ name: owner.providerName, metadata: { placeId: "place:exact" } }, { name: "locations/another", metadata: { placeId: "place:exact" } }] } }))
    if (scenario === "identity-unconfirmed" || scenario === "concurrent-edit" || scenario === "concurrent-rematch") google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, async () => {
      if (scenario === "concurrent-edit") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
      if (scenario === "concurrent-rematch") await admin`update google_onboarding_draft set match_request_id = ${randomUUID()} where id = ${owner.draft.id}`
      return { status: 200, json: { name: scenario === "identity-unconfirmed" ? "locations/wrong" : owner.providerName, title: "Provider business", metadata: { placeId: "place:exact" } } }
    })
    const response = await request(owner, "", owner.input, other?.cookie ?? owner.cookie)
    expect(response.status, await response.clone().text()).toBe(scenario === "cross-tenant" ? 404 : scenario === "viewer" ? 403 : scenario === "identity-unconfirmed" ? 502 : 409)
    expect(await admin`select id from google_onboarding_match_link_review where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  })

  it("enforces tenant isolation and immutable frozen reviews through the runtime database role", async () => {
    const owner = await fixture()
    const saved = await review(owner)
    const other = await createTestTenant(admin)
    organisations.push(other.organisationId)
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL ?? "", { max: 1 })
    try {
      await runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${other.organisationId}, true)`
        expect(await sql`select id from google_onboarding_match_link_review where id = ${saved.id}`).toHaveLength(0)
      })
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`
        await sql`update google_onboarding_match_link_review set frozen = '{}'::jsonb where id = ${saved.id}`
      })).rejects.toMatchObject({ code: "42501" })
      await expect(runtime.begin(async (sql) => {
        await sql`select set_config('app.organisation_id', ${other.organisationId}, true)`
        await sql`insert into google_onboarding_match_link_review (organisation_id, draft_id, match_request_id, frozen, review_hash, requested_by, require_two_person_approval)
          values (${other.organisationId}, ${owner.draft.id}, ${randomUUID()}, '{}'::jsonb, ${"a".repeat(64)}, ${other.userId}, false)`
      })).rejects.toMatchObject({ code: "23503" })
    } finally { await runtime.end() }
  })

  it("purges local-link reviews when their retained parent draft is deleted", async () => {
    const owner = await fixture()
    const saved = await review(owner)
    await admin`delete from google_onboarding_draft where id = ${owner.draft.id}`
    expect(await admin`select id from google_onboarding_match_link_review where id = ${saved.id}`).toHaveLength(0)
  })

  it("atomically links one exact resource and restores the same result when submit is repeated", async () => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    const response = await operation(owner, saved)
    expect(response.status, await response.clone().text()).toBe(200)
    const linked = onboardingMatchLinkOperationSchema.parse(await response.json())
    expect(linked).toMatchObject({ draftId: owner.draft.id, reviewId: saved.id, state: "linked", attemptGeneration: 1, errorCode: null })
    const [local] = await admin`select name, timezone, address_json from location where id = ${linked.locationId}`
    expect(local).toMatchObject({ name: owner.input.localName, timezone: "Europe/London", address_json: { regionCode: "GB", addressLines: ["1 High Street"] } })
    expect(await admin`select id from location_link where organisation_id = ${owner.organisationId} and location_id = ${linked.locationId} and external_location_id = ${linked.externalLocationId} and is_active`).toHaveLength(1)
    expect(await admin`select google_location_name from webhook_route where organisation_id = ${owner.organisationId} and external_location_id = ${linked.externalLocationId}`).toEqual([{ google_location_name: owner.providerName }])
    expect(await admin`select status from sync_checkpoint where organisation_id = ${owner.organisationId} and external_location_id = ${linked.externalLocationId} and sync_type = 'backfill'`).toEqual([{ status: "pending" }])
    const repeated = await operation(owner, saved)
    expect(onboardingMatchLinkOperationSchema.parse(await repeated.json())).toEqual(linked)
    const restored = await operation(owner)
    expect(onboardingMatchLinkOperationSchema.parse(await restored.json())).toEqual(linked)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(1)
    expect(await admin`select id from google_onboarding_creation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(google.calls.filter((call) => call.method !== "GET" && !call.path.includes("googleLocations:search"))).toHaveLength(0)
  })

  it("reuses an explicitly reviewed unlinked external row without rewriting its cached content", async () => {
    const owner = await fixture()
    const externalId = randomUUID()
    await admin`insert into external_location (id, organisation_id, google_connection_id, google_account_name, google_location_name, title) values (${externalId}, ${owner.organisationId}, ${owner.connectionId}, ${owner.googleAccountName}, ${owner.providerName}, 'Preserved cache title')`
    const saved = await approvedReview(owner)
    expect(saved.externalLocationId).toBe(externalId)
    const response = await operation(owner, saved)
    expect(response.status, await response.clone().text()).toBe(200)
    expect(onboardingMatchLinkOperationSchema.parse(await response.json())).toMatchObject({ state: "linked", externalLocationId: externalId })
    expect(await admin`select title from external_location where id = ${externalId}`).toEqual([{ title: "Preserved cache title" }])
  })

  it("rolls back a failed mapping transaction and retries the same operation identity", async () => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    const marker = randomUUID().replaceAll("-", "")
    const functionName = `test_link_fail_${marker}`
    await admin.unsafe(`create function ${functionName}() returns trigger language plpgsql as $$ begin raise exception 'Fixture mapping failure' using errcode = '40001'; end $$`)
    await admin.unsafe(`create trigger ${functionName} before insert on location for each row when (new.organisation_id = '${owner.organisationId}'::uuid) execute function ${functionName}()`)
    let failedId: string
    try {
      const response = await operation(owner, saved)
      expect(response.status, await response.clone().text()).toBe(200)
      const failed = onboardingMatchLinkOperationSchema.parse(await response.json())
      expect(failed).toMatchObject({ state: "failed", attemptGeneration: 1, locationId: null, externalLocationId: null, errorCode: "onboarding_match_link_failed" })
      failedId = failed.id
      expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect(await admin`select id from external_location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect(await admin`select google_location_name from webhook_route where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect(await admin`select id from sync_checkpoint where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    } finally {
      await admin.unsafe(`drop trigger ${functionName} on location`)
      await admin.unsafe(`drop function ${functionName}()`)
    }
    const retried = await operation(owner, saved)
    expect(retried.status, await retried.clone().text()).toBe(200)
    expect(onboardingMatchLinkOperationSchema.parse(await retried.json())).toMatchObject({ id: failedId, state: "linked", attemptGeneration: 2, errorCode: null })
    expect(await admin`select id from google_onboarding_match_link where organisation_id = ${owner.organisationId}`).toHaveLength(1)
  })

  it.each(["pending", "interrupted"] as const)("restores an existing %s operation without issuing a Google create", async (scenario) => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    const operationId = randomUUID()
    await admin`insert into google_onboarding_match_link (id, organisation_id, draft_id, review_id, review_hash, actor_user_id, updated_at) values (${operationId}, ${owner.organisationId}, ${owner.draft.id}, ${saved.id}, ${saved.reviewHash}, ${owner.userId}, ${scenario === "interrupted" ? new Date(Date.now() - 180_000) : new Date()})`
    const restored = await operation(owner)
    expect(restored.status).toBe(200)
    expect(onboardingMatchLinkOperationSchema.parse(await restored.json())).toMatchObject({ id: operationId, state: scenario === "interrupted" ? "failed" : "pending", errorCode: scenario === "interrupted" ? "onboarding_match_link_interrupted" : null })
    const retried = await operation(owner, saved)
    expect(retried.status, await retried.clone().text()).toBe(200)
    expect(onboardingMatchLinkOperationSchema.parse(await retried.json())).toMatchObject({ id: operationId, state: scenario === "interrupted" ? "linked" : "pending", attemptGeneration: scenario === "interrupted" ? 2 : 1 })
    expect(google.calls.filter((call) => call.method !== "GET" && !call.path.includes("googleLocations:search"))).toHaveLength(0)
  })

  it.each(["not-approved", "provider-changed", "account-lost", "policy-changed", "approval-revoked", "expired", "cross-tenant", "viewer", "hash-changed"] as const)("claims no mapping when execution is %s", async (scenario) => {
    const owner = await fixture()
    const saved = scenario === "not-approved" ? await review(owner) : await approvedReview(owner)
    if (scenario === "provider-changed") google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, () => ({ status: 200, json: { name: owner.providerName, title: "Changed business", metadata: { placeId: "place:exact" } } }))
    if (scenario === "account-lost") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, () => ({ status: 200, json: {} }))
    if (scenario === "policy-changed") await admin`update organisation set require_two_person_approval = true where id = ${owner.organisationId}`
    if (scenario === "approval-revoked") await admin`update google_onboarding_match_link_review set approved_by = null, approved_at = null where id = ${saved.id}`
    if (scenario === "expired") await admin`update google_onboarding_match_link_review set approval_expires_at = now() - interval '1 second' where id = ${saved.id}`
    const other = scenario === "cross-tenant" || scenario === "viewer" ? await createTestTenant(admin, { role: scenario === "viewer" ? "viewer" : "owner" }) : null
    if (other) organisations.push(other.organisationId)
    const response = await operation(owner, scenario === "hash-changed" ? { ...saved, reviewHash: "b".repeat(64) } : saved, other?.cookie ?? owner.cookie)
    expect(response.status, await response.clone().text()).toBe(scenario === "cross-tenant" ? 404 : scenario === "viewer" ? 403 : 409)
    expect(await admin`select id from google_onboarding_match_link where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  })

  it("blocks draft editing, rematching and creation when a link claim is active", async () => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    await admin`insert into google_onboarding_match_link (organisation_id, draft_id, review_id, review_hash, actor_user_id) values (${owner.organisationId}, ${owner.draft.id}, ${saved.id}, ${saved.reviewHash}, ${owner.userId})`
    for (const target of [{ suffix: "", method: "PUT", body: { expectedRevision: 1, payload: { title: "Changed title" } } }, { suffix: "/matches", method: "POST", body: { expectedRevision: 1 } }, { suffix: "/creation", method: "POST", body: { reviewId: randomUUID(), expectedReviewHash: "a".repeat(64) } }]) {
      const response = await fetch(`${server.baseUrl}${owner.path}${target.suffix}`, { method: target.method, headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify(target.body) })
      expect(response.status, await response.clone().text()).toBe(409)
      expect((await response.json()).error).toBe("onboarding_match_link_started")
    }
  })

  it("keeps exactly one winning operation when approved creation and linking race", async () => {
    const owner = await fixture()
    let creations = 0
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, (call) => {
      if (new URL(call.path, google.baseUrl).searchParams.get("validateOnly") === "true") return { status: 200, json: {} }
      creations++
      return { status: 400, json: { error: { status: "INVALID_ARGUMENT" } } }
    })
    const linkReview = await approvedReview(owner)
    const createReview = await creationReview(owner)
    let arrived = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const arrive = async () => { arrived++; if (arrived === 2) release?.(); await gate }
    google.respond({ method: "POST", pathIncludes: "/googleLocations:search" }, async () => { await arrive(); return { status: 200, json: { googleLocations: owner.draft.matchResult?.matches } } })
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.providerName}?` }, async () => { await arrive(); return { status: 200, json: { name: owner.providerName, title: "Provider business", metadata: { placeId: "place:exact" }, storefrontAddress: { regionCode: "GB", addressLines: ["1 High Street"] } } } })
    const responses = await Promise.all([operation(owner, linkReview), fetch(`${server.baseUrl}${owner.path}/creation`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ reviewId: createReview.id, expectedReviewHash: createReview.reviewHash }) })])
    expect(responses.map((response) => response.status).sort()).toEqual([200, 409])
    const links = await admin`select state from google_onboarding_match_link where organisation_id = ${owner.organisationId}`
    const created = await admin`select id from google_onboarding_creation where organisation_id = ${owner.organisationId}`
    expect(links.length + created.length).toBe(1)
    expect(creations).toBe(created.length)
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(links.length)
  }, 15_000)

  it("restores the same result when a duplicate submission finishes discovery after the first one linked", async () => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    let arrivals = 0
    let releaseFirst: (() => void) | undefined
    let releaseSecond: (() => void) | undefined
    const bothArrived = new Promise<void>((resolve) => { releaseFirst = resolve })
    const firstFinished = new Promise<void>((resolve) => { releaseSecond = resolve })
    google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, async () => {
      arrivals++
      const arrival = arrivals
      if (arrival === 2) releaseFirst?.()
      await bothArrived
      if (arrival === 2) await firstFinished
      return { status: 200, json: { locations: [{ name: owner.providerName, title: "Provider business", metadata: { placeId: "place:exact" } }] } }
    })
    const submissions = [operation(owner, saved), operation(owner, saved)]
    await Promise.race(submissions)
    releaseSecond?.()
    const responses = await Promise.all(submissions)
    expect(responses.map((response) => response.status)).toEqual([200, 200])
    const results = await Promise.all(responses.map(async (response) => onboardingMatchLinkOperationSchema.parse(await response.json())))
    expect(results[0]).toMatchObject({ state: "linked", attemptGeneration: 1 })
    expect(results[1]).toEqual(results[0])
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(1)
  }, 15_000)

  it("extends existing whole-client holders and preserves prior grants when linking under that client", async () => {
    const owner = await fixture()
    const clientId = randomUUID()
    const priorLocationId = randomUUID()
    await admin`insert into client (id, organisation_id, name, slug) values (${clientId}, ${owner.organisationId}, 'Fixture client', 'fixture-client')`
    await admin`insert into client_google_connection (organisation_id, client_id, google_connection_id) values (${owner.organisationId}, ${clientId}, ${owner.connectionId})`
    await admin`insert into location (id, organisation_id, client_id, name) values (${priorLocationId}, ${owner.organisationId}, ${clientId}, 'Prior client location')`
    const holder = await seedMemberUser(admin, { organisationId: owner.organisationId, canPublish: true, assignLocationId: priorLocationId })
    await admin`update google_onboarding_draft set client_id = ${clientId} where id = ${owner.draft.id}`
    const saved = await approvedReview(owner)
    const response = await operation(owner, saved)
    expect(response.status, await response.clone().text()).toBe(200)
    const linked = onboardingMatchLinkOperationSchema.parse(await response.json())
    expect(linked.state).toBe("linked")
    expect(await admin`select client_id from location where id = ${linked.locationId}`).toEqual([{ client_id: clientId }])
    expect(await admin`select location_id, can_publish from location_member where user_id = ${holder.userId} order by location_id`).toEqual([priorLocationId, linked.locationId].sort().map((id) => ({ location_id: id, can_publish: true })))
  })

  it.each(["link-first", "create-first"] as const)("rejects incompatible direct runtime claims when %s already owns the draft", async (scenario) => {
    const owner = await fixture()
    google.respond({ method: "POST", pathIncludes: `/v1/${owner.googleAccountName}/locations?` }, () => ({ status: 200, json: {} }))
    const saved = await approvedReview(owner)
    const createReview = await creationReview(owner)
    const runtime = postgres(process.env.TEST_RUNTIME_DATABASE_URL ?? "", { max: 1 })
    const link = (sql: postgres.TransactionSql) => sql`insert into google_onboarding_match_link (organisation_id, draft_id, review_id, review_hash, actor_user_id) values (${owner.organisationId}, ${owner.draft.id}, ${saved.id}, ${saved.reviewHash}, ${owner.userId})`
    const create = (sql: postgres.TransactionSql) => sql`insert into google_onboarding_creation (organisation_id, draft_id, review_id, review_hash, actor_user_id) values (${owner.organisationId}, ${owner.draft.id}, ${createReview.id}, ${createReview.reviewHash}, ${owner.userId})`
    try {
      await runtime.begin(async (sql) => { await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`; await (scenario === "link-first" ? link(sql) : create(sql)) })
      await expect(runtime.begin(async (sql) => { await sql`select set_config('app.organisation_id', ${owner.organisationId}, true)`; await (scenario === "link-first" ? create(sql) : link(sql)) })).rejects.toMatchObject({ code: "23505", constraint_name: "onboarding_operation_conflict" })
    } finally { await runtime.end() }
  })

  it("recovers a committed claim after the application process is stopped during its mapping transaction", async () => {
    const owner = await fixture()
    const saved = await approvedReview(owner)
    const marker = randomUUID().replaceAll("-", "")
    const functionName = `test_link_block_${marker}`
    const lockKey = 100_000 + Math.floor(Math.random() * 1_000_000)
    const blocker = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    const connection = await blocker.reserve()
    let stopped = false
    await connection`select pg_advisory_lock(${lockKey})`
    await admin.unsafe(`create function ${functionName}() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${lockKey}); return new; end $$`)
    await admin.unsafe(`create trigger ${functionName} before insert on external_location for each row when (new.google_location_name = '${owner.providerName}') execute function ${functionName}()`)
    try {
      const submitted = operation(owner, saved).catch((error: unknown) => error instanceof Error ? error : new Error("Unexpected request failure", { cause: error }))
      const deadline = Date.now() + 10_000
      let blocked = false
      while (!blocked && Date.now() < deadline) {
        const locks = await admin`select pid from pg_locks where locktype = 'advisory' and objid = ${lockKey} and not granted`
        blocked = locks.length === 1
      }
      expect(blocked).toBe(true)
      stopped = true
      await server.stop()
      expect(await submitted).toBeInstanceOf(Error)
      expect(await admin`select state from google_onboarding_match_link where organisation_id = ${owner.organisationId}`).toEqual([{ state: "pending" }])
      expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
      expect(await admin`select id from external_location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    } finally {
      await connection`select pg_advisory_unlock(${lockKey})`
      connection.release()
      await blocker.end()
      await admin.unsafe(`drop trigger ${functionName} on external_location`)
      await admin.unsafe(`drop function ${functionName}()`)
      if (stopped) server = await bootServer()
    }
    await admin`update google_onboarding_match_link set updated_at = now() - interval '3 minutes' where organisation_id = ${owner.organisationId}`
    const interrupted = await operation(owner)
    expect(onboardingMatchLinkOperationSchema.parse(await interrupted.json())).toMatchObject({ state: "failed", errorCode: "onboarding_match_link_interrupted" })
    const recovered = await operation(owner, saved)
    expect(recovered.status, await recovered.clone().text()).toBe(200)
    expect(onboardingMatchLinkOperationSchema.parse(await recovered.json())).toMatchObject({ state: "linked", attemptGeneration: 2 })
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(1)
    expect(await admin`select id from google_onboarding_creation where organisation_id = ${owner.organisationId}`).toHaveLength(0)
  }, 30_000)
})
