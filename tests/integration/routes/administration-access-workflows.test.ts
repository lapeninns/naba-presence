import { describe, expect, it } from "vitest"
import { ADMINISTRATION_CONFIRMATIONS } from "@/lib/contracts/location-administration"
import { administrationWorkflowsResponseSchema } from "@/lib/contracts/google-administration-workflows"
import { administrationHarness } from "../helpers/administration-access"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("administration saved work and direct-write retirement", () => {
  const harness = administrationHarness()
  it.each(["create_admin", "update_admin", "delete_admin", "accept_invitation", "decline_invitation"] as const)("retires the direct %s path before claiming an attempt or contacting Google", async (operation) => {
    const fixture = await harness.fixture()
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.location.locationId}/administration`, { method: "PATCH", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" }, body: JSON.stringify({ operation, confirmation: ADMINISTRATION_CONFIRMATIONS[operation], payload: {} }) })
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: "administration_review_required" })
    expect(fixture.calls()).toHaveLength(0)
    const database = harness.database()
    expect(await database`select id from gbp_management_mutation where organisation_id = ${fixture.owner.organisationId}`).toHaveLength(0)
  })
  it("pages exact saved reviews with full PostgreSQL time precision and stable ties, including recorded outcomes after review expiry", async () => {
    const fixture = await harness.fixture()
    const first = await fixture.review({ operation: "delete_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager` } })
    const second = await fixture.review({ operation: "create_admin", payload: { scope: "location", admin: "other@example.test", role: "MANAGER" } })
    const third = await fixture.review({ operation: "update_admin", payload: { name: `${fixture.location.googleLocationName}/admins/manager`, role: "OWNER" } })
    expect((await fixture.approve(first)).status).toBe(200)
    const outcome = await fixture.execute(first)
    const database = harness.database()
    await database`update gbp_change_set set created_at = '2026-09-30T00:00:00.123456Z', approval_expires_at = case when id = ${first.changeSet.id} then now() - interval '1 day' else approval_expires_at end where organisation_id = ${fixture.owner.organisationId}`
    const root = `${fixture.baseUrl}/api/locations/${fixture.location.locationId}/administration-access-workflows?limit=1`
    let cursor: string | null = null
    const ids: string[] = []
    for (let page = 0; page < 3; page++) {
      const response = await fetch(`${root}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { headers: { cookie: fixture.owner.cookie } })
      expect(response.status).toBe(200)
      const saved = administrationWorkflowsResponseSchema.parse(await response.json())
      expect(saved.items).toHaveLength(1)
      expect(saved.items[0].createdAt).toBe("2026-09-30T00:00:00.123456Z")
      ids.push(saved.items[0].reviewId)
      if (saved.items[0].reviewId === first.changeSet.id) expect(saved.items[0]).toMatchObject({ attemptId: outcome.id, confirmationState: "confirmed" })
      cursor = saved.nextCursor
    }
    expect(new Set(ids)).toEqual(new Set([first.changeSet.id, second.changeSet.id, third.changeSet.id]))
    expect(cursor).toBeNull()
    expect(await fixture.execute(first, "PATCH")).toMatchObject({ id: outcome.id, confirmationState: "confirmed" })
    expect(fixture.writes()).toHaveLength(1)
    const invalid = await fetch(`${root}&cursor=invalid`, { headers: { cookie: fixture.owner.cookie } })
    expect(invalid.status).toBe(400)
  })
})
