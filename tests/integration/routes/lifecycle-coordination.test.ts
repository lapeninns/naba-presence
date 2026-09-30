import { describe, expect, it } from "vitest"
import { lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"
import { administrationAccessReviewResponseSchema } from "@/lib/contracts/google-administration-review"
import { lifecycleHarness } from "../helpers/google-lifecycle"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("lifecycle and access account coordination", { timeout: 40_000 }, () => {
  const harness = lifecycleHarness()
  it("serializes a transfer with both a duplicate lifecycle send and an independently approved access send", async () => {
    const fixture = await harness.fixture()
    const response = await fixture.request("", "POST", { operation: "transfer_location", payload: { destinationAccount: fixture.destinationAccount } })
    expect(response.status).toBe(200)
    const review = lifecycleReviewResponseSchema.parse(await response.json()).review
    const body = { expectedPayloadHash: review.changeSet.payloadHash }
    expect((await fixture.request(`/${review.changeSet.id}`, "POST", body)).status).toBe(200)
    fixture.provider.respond({ method: "GET", pathEndsWith: `${fixture.linked.googleLocationName}/admins` }, () => ({ status: 200, json: { admins: [] } }))
    const accessRoot = `${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/administration-access-reviews`
    const headers = { cookie: fixture.owner.cookie, "content-type": "application/json" }
    const accessResponse = await fetch(accessRoot, { method: "POST", headers, body: JSON.stringify({ operation: "create_admin", payload: { scope: "location", role: "MANAGER", admin: "invitee@example.test" } }) })
    expect(accessResponse.status).toBe(200)
    const access = administrationAccessReviewResponseSchema.parse(await accessResponse.json()).review
    const accessBody = JSON.stringify({ expectedPayloadHash: access.changeSet.payloadHash })
    expect((await fetch(`${accessRoot}/${access.changeSet.id}`, { method: "POST", headers, body: accessBody })).status).toBe(200)
    fixture.state.delayMs = 3_000
    const first = fixture.request(`/${review.changeSet.id}/execute`, "POST", body)
    await expect.poll(() => fixture.writes().length, { timeout: 10_000 }).toBe(1)
    const duplicate = await fixture.request(`/${review.changeSet.id}/execute`, "POST", body)
    expect(duplicate.status).toBe(409); expect(await duplicate.json()).toMatchObject({ error: "administration_in_progress" })
    const competing = await fetch(`${accessRoot}/${access.changeSet.id}/execute`, { method: "POST", headers, body: accessBody })
    expect(competing.status).toBe(409); expect(await competing.json()).toMatchObject({ error: "administration_in_progress" })
    expect((await first).status).toBe(200)
    expect(fixture.provider.calls.filter((call) => call.method !== "GET")).toHaveLength(1)
  })
})
