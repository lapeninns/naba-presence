import { describe, expect, it } from "vitest"
import { lifecycleReviewResponseSchema } from "@/lib/contracts/google-lifecycle-review"
import { lifecycleWorkflowsResponseSchema } from "@/lib/contracts/google-lifecycle-workflows"
import { lifecycleHarness } from "../helpers/google-lifecycle"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("lifecycle saved-work access and precision", { timeout: 60_000 }, () => {
  const harness = lifecycleHarness()
  it("paginates equal-millisecond reviews without duplicates and isolates the cursor to its location", async () => {
    const fixture = await harness.fixture(), ids: string[] = []
    for (let index = 0; index < 7; index++) {
      const response = await fixture.request("", "POST", { operation: "delete_location", payload: {} })
      expect(response.status).toBe(200)
      const review = lifecycleReviewResponseSchema.parse(await response.json()).review
      ids.push(review.changeSet.id)
      await harness.database()`update gbp_change_set set created_at = ${`2026-09-30T08:00:00.00000${index}Z`}::text::timestamptz where id = ${review.changeSet.id}`
    }
    const calls = fixture.calls().length, seen: string[] = []
    let cursor: string | null = null, firstCursor: string | null = null
    for (let page = 0; page < 4; page++) {
      const response = await fixture.request(`?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`)
      expect(response.status).toBe(200)
      const result = lifecycleWorkflowsResponseSchema.parse(await response.json())
      seen.push(...result.items.map((item) => item.reviewId)); cursor = result.nextCursor
      if (page === 0) firstCursor = cursor
    }
    expect(cursor).toBeNull(); expect(seen).toEqual([...ids].reverse())
    expect(new Set(seen).size).toBe(7); expect(fixture.calls()).toHaveLength(calls)
    const other = await harness.fixture()
    const wrongCursor = await other.request(`?cursor=${encodeURIComponent(firstCursor ?? "")}`)
    expect(wrongCursor.status).toBe(400)
    expect((await fixture.request("", "GET", undefined, other.owner.cookie)).status).toBe(404)
  })
  it("lists an expired recorded outcome after disconnection without Google transport reads", async () => {
    const fixture = await harness.fixture()
    const response = await fixture.request("", "POST", { operation: "delete_location", payload: {} })
    expect(response.status).toBe(200)
    const review = lifecycleReviewResponseSchema.parse(await response.json()).review
    const body = { expectedPayloadHash: review.changeSet.payloadHash }
    expect((await fixture.request(`/${review.changeSet.id}`, "POST", body)).status).toBe(200)
    expect((await fixture.request(`/${review.changeSet.id}/execute`, "POST", body)).status).toBe(200)
    await harness.database()`update gbp_change_set set approval_expires_at = now() - interval '1 hour' where id = ${review.changeSet.id}`
    await harness.database()`update google_connection set status = 'disconnected' where id = ${fixture.connection.connectionId}`
    const calls = fixture.calls().length
    const saved = await fixture.request("")
    expect(saved.status).toBe(200)
    const result = lifecycleWorkflowsResponseSchema.parse(await saved.json())
    expect(result.items).toHaveLength(1); expect(result.items[0].reviewId).toBe(review.changeSet.id)
    expect(result.items[0].attemptId).not.toBeNull(); expect(fixture.calls()).toHaveLength(calls)
  })
})
