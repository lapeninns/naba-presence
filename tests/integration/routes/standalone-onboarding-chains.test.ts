import { randomUUID } from "node:crypto"
import postgres from "postgres"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { googleOnboardingDraftSchema } from "@/lib/contracts/google-onboarding"
import { onboardingChainsResponseSchema } from "@/lib/contracts/google-onboarding-chains"
import { startAppServer } from "../helpers/app-server"
import { startGoogleStub, type GoogleStub } from "../helpers/google-stub"
import { createTestTenant, destroyTenants, seedGoogleConnection } from "../helpers/tenant"

const database = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip

database("standalone onboarding chain search", () => {
  let admin: ReturnType<typeof postgres>
  let google: GoogleStub
  let server: Awaited<ReturnType<typeof startAppServer>>
  const organisations: string[] = []
  beforeAll(async () => {
    admin = postgres(process.env.DIRECT_DATABASE_URL ?? "", { max: 1 })
    google = await startGoogleStub()
    server = await startAppServer({ GOOGLE_API_PROXY_BASE: google.baseUrl, DATABASE_SESSION_URL: process.env.TEST_RUNTIME_DATABASE_URL ?? "", DATABASE_POOL_MAX: "1" })
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
    const response = await fetch(`${server.baseUrl}/api/google/accounts/${account.id}/drafts`, { method: "POST", headers: { cookie: owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ draftId, connectionId: connection.connectionId, payload: { title: "New shop" } }) })
    expect(response.status, await response.clone().text()).toBe(200)
    const draft = googleOnboardingDraftSchema.parse(await response.json())
    google.reset()
    google.respond({ method: "GET", pathIncludes: `/v1/${connection.googleAccountName}` }, () => ({ status: 200, json: { name: connection.googleAccountName } }))
    return { ...owner, ...connection, path, draft }
  }

  function search(owner: Awaited<ReturnType<typeof fixture>>, revision = 1, cookie = owner.cookie, query = "Brand") {
    return fetch(`${server.baseUrl}${owner.path}/chains?${new URLSearchParams({ expectedRevision: String(revision), query })}`, { headers: { cookie } })
  }

  it.each(["complete", "empty", "malformed", "duplicate", "edited", "revoked"] as const)("checks chain results and current scope: %s", async (scenario) => {
    const owner = await fixture()
    let calls = 0
    google.respond({ method: "GET", pathIncludes: "/chains:search" }, async (call) => {
      calls++
      const params = new URL(call.path, google.baseUrl).searchParams
      expect(params.get("chainName")).toBe("Brand")
      expect(params.get("pageSize")).toBe("100")
      if (scenario === "edited") await admin`update google_onboarding_draft set revision = revision + 1 where id = ${owner.draft.id}`
      if (scenario === "revoked") await admin`update google_connection set status = 'revoked' where id = ${owner.connectionId}`
      return { status: 200, json: scenario === "empty" ? {} : scenario === "malformed" ? { chains: [{ name: "invented" }] } : { chains: [
        { name: "chains/123", chainNames: [{ displayName: "Marque", languageCode: "fr" }, { displayName: "Brand", languageCode: "en-GB" }], locationCount: 42 },
        ...(scenario === "duplicate" ? [{ name: "chains/123" }] : []),
      ] } }
    })
    const response = await search(owner)
    expect(response.status, await response.clone().text()).toBe(scenario === "malformed" || scenario === "duplicate" ? 502 : scenario === "edited" ? 409 : scenario === "revoked" ? 404 : 200)
    expect(calls).toBe(1)
    if (response.ok) expect(onboardingChainsResponseSchema.parse(await response.json())).toEqual({ draftId: owner.draft.id, revision: 1, payloadHash: owner.draft.payloadHash, query: "Brand", choices: scenario === "empty" ? [] : [{ name: "chains/123", label: "Brand" }] })
    expect(await admin`select id from location where organisation_id = ${owner.organisationId}`).toHaveLength(0)
    expect((await admin`select payload from google_onboarding_draft where id = ${owner.draft.id}`)[0].payload).toEqual(owner.draft.payload)
  })

  it.each(["stale", "invalid-query", "account-denied", "account-unconfirmed", "cross-tenant", "viewer"] as const)("rejects invalid scope before chain discovery: %s", async (scenario) => {
    const owner = await fixture()
    let calls = 0
    google.respond({ method: "GET", pathIncludes: "/chains:search" }, () => { calls++; return { status: 200, json: {} } })
    if (scenario === "account-denied" || scenario === "account-unconfirmed") google.respond({ method: "GET", pathIncludes: `/v1/${owner.googleAccountName}` }, () => ({ status: scenario === "account-denied" ? 403 : 200, json: scenario === "account-denied" ? { error: { status: "PERMISSION_DENIED" } } : { name: "accounts/wrong" } }))
    const other = scenario === "cross-tenant" || scenario === "viewer" ? await createTestTenant(admin, { role: scenario === "viewer" ? "viewer" : "owner" }) : null
    if (other) organisations.push(other.organisationId)
    const response = await search(owner, scenario === "stale" ? 2 : 1, other?.cookie ?? owner.cookie, scenario === "invalid-query" ? " " : "Brand")
    expect(response.status).toBe(scenario === "viewer" || scenario === "account-denied" ? 403 : scenario === "cross-tenant" ? 404 : scenario === "account-unconfirmed" ? 502 : scenario === "invalid-query" ? 400 : 409)
    expect(calls).toBe(0)
  })
})
