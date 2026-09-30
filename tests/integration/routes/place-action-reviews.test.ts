import { describe, expect, it } from "vitest"
import { lifecycleHarness } from "../helpers/google-lifecycle"
import { placeActionInputSchema } from "@/lib/contracts/location-place-actions"
import { placeActionAttemptResponseSchema, placeActionReviewResponseSchema, type ReviewedPlaceActionRequest } from "@/lib/contracts/place-action-review"
import { placeActionWorkflowsResponseSchema } from "@/lib/contracts/place-action-workflows"
import { createTestTenant } from "../helpers/tenant"
import { lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("reviewed Place Actions", { timeout: 30_000 }, () => {
  const harness = lifecycleHarness({ GBP_PLACE_ACTIONS_ENABLED: "true" })
  const payload = { uri: "https://shop.example.test/catalogue", placeActionType: "SHOP_ONLINE", isPreferred: false }
  async function fixture() {
    const base = await harness.fixture()
    const state: { links: Array<Record<string, unknown>>; supported: string[]; status: number; apply: boolean; readStatus: number; delayMs: number } = { links: [], supported: ["SHOP_ONLINE"], status: 200, apply: true, readStatus: 200, delayMs: 0 }
    base.provider.respond({ method: "GET", pathIncludes: "/placeActionTypeMetadata" }, () => ({ status: state.readStatus, json: { placeActionTypeMetadata: state.supported.map((placeActionType) => ({ placeActionType })) } }))
    base.provider.respond({ method: "GET", pathIncludes: "/placeActionLinks" }, () => ({ status: state.readStatus, json: { placeActionLinks: state.links } }))
    base.provider.respond({ method: "POST", pathIncludes: "/placeActionLinks" }, (call) => {
      const link = { name: `${base.linked.googleLocationName}/placeActionLinks/link${state.links.length + 1}`, providerType: "MERCHANT", isEditable: true, ...placeActionInputSchema.parse(call.body), createTime: null, updateTime: null }
      if (state.apply) state.links.push(link)
      return { status: state.status, json: state.status === 200 ? link : { error: { status: "UNAVAILABLE" } }, delayMs: state.delayMs }
    })
    base.provider.respond({ method: "PATCH", pathIncludes: "/placeActionLinks/" }, (call) => {
      const name = new URL(call.path, "https://fixture.test").pathname.replace(/^\/v1\//, "")
      const requested = placeActionInputSchema.parse(call.body)
      if (state.apply) state.links = state.links.map((link) => link.name === name ? { ...link, ...requested } : link)
      return { status: state.status, json: state.links.find((link) => link.name === name) ?? {} }
    })
    base.provider.respond({ method: "DELETE", pathIncludes: "/placeActionLinks/" }, (call) => {
      const name = new URL(call.path, "https://fixture.test").pathname.replace(/^\/v1\//, "")
      if (state.apply) state.links = state.links.filter((link) => link.name !== name)
      return { status: state.status, json: {} }
    })
    const root = `${base.baseUrl}/api/locations/${base.linked.locationId}/place-action-reviews`
    const request = (path = "", method = "GET", body?: unknown, cookie = base.owner.cookie) => fetch(`${root}${path}`, { method, headers: { cookie, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    async function preview(requested: ReviewedPlaceActionRequest = { operation: "create", payload: placeActionInputSchema.parse(payload) }) {
      const response = await request("", "POST", requested)
      expect(response.status, await response.clone().text()).toBe(200)
      return placeActionReviewResponseSchema.parse(await response.json()).review
    }
    async function approved(requested?: ReviewedPlaceActionRequest) {
      const review = await preview(requested)
      const response = await request(`/${review.changeSet.id}`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
      expect(response.status, await response.clone().text()).toBe(200)
      return placeActionReviewResponseSchema.parse(await response.json()).review
    }
    const writes = () => base.provider.calls.filter((call) => ["POST", "PATCH", "DELETE"].includes(call.method) && call.path.includes("placeActionLinks"))
    return { ...base, state, request, preview, approved, writes }
  }
  it("requires approval, sends one exact create, independently reads and deduplicates a new HTTP retry", async () => {
    const f = await fixture(), review = await f.preview()
    const body = { expectedPayloadHash: review.changeSet.payloadHash }, path = `/${review.changeSet.id}/execute`
    const unapproved = await f.request(path, "POST", body)
    expect(unapproved.status).toBe(409); expect(f.writes()).toHaveLength(0)
    expect((await f.request(`/${review.changeSet.id}`, "POST", body)).status).toBe(200)
    expect(f.writes()).toHaveLength(0)
    const sent = await f.request(path, "POST", body)
    expect(sent.status, await sent.clone().text()).toBe(200)
    const attempt = placeActionAttemptResponseSchema.parse(await sent.json()).attempt
    expect(attempt).toMatchObject({ reviewId: review.changeSet.id, executionState: "accepted", confirmationState: "confirmed", idempotent: false })
    expect(attempt.observedAt).not.toBeNull()
    const calls = f.provider.calls.length
    const retry = await f.request(path, "POST", body)
    expect(placeActionAttemptResponseSchema.parse(await retry.json()).attempt).toMatchObject({ id: attempt.id, idempotent: true })
    expect(f.provider.calls).toHaveLength(calls); expect(f.writes()).toHaveLength(1)
    expect(f.provider.calls.slice(f.provider.calls.indexOf(f.writes()[0]) + 1).some((call) => call.method === "GET" && call.path.includes("placeActionLinks"))).toBe(true)
  })
  it("keeps unknown acknowledgement distinct from confirmed applied creation and never resends", async () => {
    const f = await fixture(), review = await f.approved()
    f.state.status = 503
    const response = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    expect(response.status, await response.clone().text()).toBe(200)
    expect(placeActionAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ executionState: "unknown", confirmationState: "confirmed" })
    await f.request(`/${review.changeSet.id}/execute`, "PATCH", {})
    expect(f.writes()).toHaveLength(1)
  })
  it("blocks unresolved creation and recovers through a separate observation without another mutation", async () => {
    const f = await fixture(), review = await f.approved(), next = await f.approved({ operation: "create", payload: { ...placeActionInputSchema.parse(payload), uri: "https://shop.example.test/second" } })
    f.state.status = 503; f.state.apply = false
    const sent = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    expect(placeActionAttemptResponseSchema.parse(await sent.json()).attempt).toMatchObject({ executionState: "unknown", confirmationState: "unresolved" })
    expect((await f.request(`/${next.changeSet.id}/execute`, "POST", { expectedPayloadHash: next.changeSet.payloadHash })).status).toBe(409)
    f.state.links.push({ name: `${f.linked.googleLocationName}/placeActionLinks/recovered`, providerType: "MERCHANT", isEditable: true, ...payload })
    const refreshed = await f.request(`/${review.changeSet.id}/execute`, "PATCH", {})
    expect(placeActionAttemptResponseSchema.parse(await refreshed.json()).attempt).toMatchObject({ executionState: "unknown", confirmationState: "confirmed" })
    expect(f.writes()).toHaveLength(1)
  })
  it("rejects metadata and full collection drift after approval before any mutation", async () => {
    const f = await fixture(), review = await f.approved()
    f.state.supported = ["APPOINTMENT"]
    expect((await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })).status).toBe(409)
    f.state.supported = ["SHOP_ONLINE"]
    f.state.links.push({ name: `${f.linked.googleLocationName}/placeActionLinks/other`, providerType: "AGGREGATOR_3P", isEditable: false, ...payload, uri: "https://provider.example.test/other" })
    expect((await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })).status).toBe(409)
    expect(f.writes()).toHaveLength(0)
  })
  it("updates and deletes only the reviewed editable resource with independently observed values", async () => {
    const f = await fixture(), name = `${f.linked.googleLocationName}/placeActionLinks/merchant`
    f.state.links.push({ name, providerType: "MERCHANT", isEditable: true, ...payload })
    const update = await f.approved({ operation: "update", name, payload: { ...placeActionInputSchema.parse(payload), isPreferred: true } })
    const sent = await f.request(`/${update.changeSet.id}/execute`, "POST", { expectedPayloadHash: update.changeSet.payloadHash })
    expect(placeActionAttemptResponseSchema.parse(await sent.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "confirmed" })
    const deletion = await f.approved({ operation: "delete", name })
    const removed = await f.request(`/${deletion.changeSet.id}/execute`, "POST", { expectedPayloadHash: deletion.changeSet.payloadHash })
    expect(placeActionAttemptResponseSchema.parse(await removed.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "confirmed" })
    expect(f.state.links).toHaveLength(0); expect(f.writes()).toHaveLength(2)
  })
  it("restores expired outcomes and the saved index after disconnection without Google reads", async () => {
    const f = await fixture(), review = await f.approved()
    await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    await harness.database()`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${review.changeSet.id}`
    await harness.database()`update google_connection set status = 'disconnected' where id = ${f.connection.connectionId}`
    const count = f.provider.calls.length
    const outcome = await f.request(`/${review.changeSet.id}/execute`)
    expect(outcome.status).toBe(200)
    expect(placeActionAttemptResponseSchema.parse(await outcome.json()).attempt.confirmationState).toBe("confirmed")
    const index = await f.request()
    expect(placeActionWorkflowsResponseSchema.parse(await index.json()).items).toMatchObject([{ changeSet: { id: review.changeSet.id } }])
    expect(f.provider.calls).toHaveLength(count)
  })
  it("protects exact review intent in the database and returns scoped 404 for another tenant", async () => {
    const f = await fixture(), review = await f.approved()
    const sent = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    const attempt = placeActionAttemptResponseSchema.parse(await sent.json()).attempt
    await expect(harness.database()`update place_action_mutation set operation = 'delete' where id = ${attempt.id}`).rejects.toMatchObject({ code: "23514" })
    const other = await createTestTenant(harness.database())
    try { expect((await f.request(`/${review.changeSet.id}/execute`, "GET", undefined, other.cookie)).status).toBe(404) }
    finally { await harness.database()`delete from organisation where id = ${other.organisationId}` }
  })
  it("does not accept a create response echo when the independent collection lacks the link", async () => {
    const f = await fixture(), review = await f.approved()
    f.state.apply = false
    const response = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    expect(placeActionAttemptResponseSchema.parse(await response.json()).attempt).toMatchObject({ executionState: "accepted", confirmationState: "unresolved" })
    expect(f.writes()).toHaveLength(1)
  })
  it("rejects a non-editable provider link and an already-present create before any mutation", async () => {
    const f = await fixture(), name = `${f.linked.googleLocationName}/placeActionLinks/provider`
    f.state.links.push({ name, providerType: "AGGREGATOR_3P", isEditable: false, ...payload })
    const response = await f.request("", "POST", { operation: "delete", name })
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "place_action_not_editable" })
    const duplicate = await f.request("", "POST", { operation: "create", payload })
    expect(duplicate.status).toBe(409); expect(await duplicate.json()).toMatchObject({ error: "place_action_already_present" })
    expect(f.writes()).toHaveLength(0)
  })
  it("rejects every legacy mutation route without contacting Google", async () => {
    const f = await fixture(), root = `${f.baseUrl}/api/locations/${f.linked.locationId}/place-actions`
    for (const [method, path, body] of [
      ["POST", "", { ...payload, confirmation: "create_google_place_action" }],
      ["PATCH", "/11111111-1111-4111-8111-111111111111", { ...payload, expectedGoogleHash: "a".repeat(64), confirmation: "update_google_place_action" }],
      ["DELETE", "/11111111-1111-4111-8111-111111111111", { expectedGoogleHash: "a".repeat(64), confirmation: "delete_google_place_action" }],
    ] satisfies Array<[string, string, unknown]>) {
      const response = await fetch(`${root}${path}`, { method, headers: { cookie: f.owner.cookie, "content-type": "application/json" }, body: JSON.stringify(body) })
      expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "place_action_review_required" })
    }
    expect(f.provider.calls).toHaveLength(0)
  })
  it("blocks expired approval and rotated credentials before a provider mutation", async () => {
    const f = await fixture(), review = await f.approved()
    await harness.database()`update google_connection set credential_generation = credential_generation + 1 where id = ${f.connection.connectionId}`
    const rotated = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    expect(rotated.status).toBe(409); expect(await rotated.json()).toMatchObject({ error: "google_connection_changed" })
    await harness.database()`update gbp_change_set set approval_expires_at = now() - interval '1 minute' where id = ${review.changeSet.id}`
    const expired = await f.request(`/${review.changeSet.id}/execute`, "POST", { expectedPayloadHash: review.changeSet.payloadHash })
    expect(expired.status).toBe(409); expect(await expired.json()).toMatchObject({ error: "approval_expired" })
    expect(f.writes()).toHaveLength(0)
  })
  it("blocks action links after an unresolved lifecycle request for the same Google account", async () => {
    const f = await fixture(), action = await f.approved()
    const lifecycleRoot = `${f.baseUrl}/api/locations/${f.linked.locationId}/administration-lifecycle-reviews`
    const headers = { cookie: f.owner.cookie, "content-type": "application/json" }
    const reviewed = await fetch(lifecycleRoot, { method: "POST", headers, body: JSON.stringify({ operation: "transfer_location", payload: { destinationAccount: f.destinationAccount } }) })
    expect(reviewed.status, await reviewed.clone().text()).toBe(200)
    const raw = lifecycleReviewResponseSchema.parse(await reviewed.json()).review
    const id = raw.changeSet.id, body = JSON.stringify({ expectedPayloadHash: raw.changeSet.payloadHash })
    expect((await fetch(`${lifecycleRoot}/${id}`, { method: "POST", headers, body })).status).toBe(200)
    f.provider.respond({ method: "POST", pathEndsWith: `${f.linked.googleLocationName}:transfer` }, () => ({ status: 503, json: { error: { status: "UNAVAILABLE" } } }))
    const sent = await fetch(`${lifecycleRoot}/${id}/execute`, { method: "POST", headers, body })
    expect(sent.status, await sent.clone().text()).toBe(200)
    const response = await f.request(`/${action.changeSet.id}/execute`, "POST", { expectedPayloadHash: action.changeSet.payloadHash })
    expect(response.status).toBe(409); expect(await response.json()).toMatchObject({ error: "google_confirmation_unresolved" })
    expect(f.writes()).toHaveLength(0)
  })
})
