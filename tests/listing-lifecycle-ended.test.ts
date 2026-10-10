import { describe, expect, it } from "vitest"

import { emptyListingSummary } from "@/lib/contracts/location-summary"
import { areaState } from "@/lib/listings/area-state"

describe("people area after the listing leaves this account", () => {
  const base = emptyListingSummary({ locationId: "11111111-1111-4111-8111-111111111111", linked: true, verified: true })
  it("says the listing was deleted or moved instead of On Google", () => {
    expect(areaState("people", base).label).toBe("On Google")
    expect(areaState("people", { ...base, lifecycleEnded: "delete_location" }).label).toBe("Deleted from Google")
    expect(areaState("people", { ...base, lifecycleEnded: "transfer_location" }).label).toBe("Moved to another account")
  })
})
