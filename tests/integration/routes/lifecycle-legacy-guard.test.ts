import { describe, expect, it } from "vitest"
import { lifecycleHarness } from "../helpers/google-lifecycle"

const describeDatabase = process.env.RUN_DB_TESTS === "true" ? describe : describe.skip
describeDatabase("legacy lifecycle review requirement", () => {
  const harness = lifecycleHarness()
  for (const operation of ["transfer_location", "delete_location"]) it(`blocks direct ${operation} before any Google call`, async () => {
    const fixture = await harness.fixture()
    const response = await fetch(`${fixture.baseUrl}/api/locations/${fixture.linked.locationId}/administration`, {
      method: "PATCH", headers: { cookie: fixture.owner.cookie, "content-type": "application/json" },
      body: JSON.stringify({ operation, confirmation: operation === "transfer_location" ? "transfer_google_location" : "delete_google_location_permanently", payload: operation === "transfer_location" ? { destinationAccount: fixture.destinationAccount } : {} }),
    })
    expect(response.status).toBe(409)
    expect(fixture.calls()).toHaveLength(0)
    expect(fixture.writes()).toHaveLength(0)
  })
})
