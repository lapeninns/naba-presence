import { describe, expect, it } from "vitest"
import { googleLifecycleBaselineSchema, googleLifecycleObservationSchema, googleLifecycleRequestSchema } from "@/lib/contracts/google-lifecycle"
import { lifecycleBaselineState, lifecycleConfirmation, lifecyclePreflightReason } from "@/lib/domain/google-lifecycle"

const location = { name: "locations/listing", placeId: "place-listed", canDelete: true }
const baseline = googleLifecycleBaselineSchema.parse({ observedAt: "2026-09-30T10:00:00.000Z", location,
  source: { account: { name: "accounts/source", role: "OWNER" }, complete: true, locations: [location] },
  destination: { account: { name: "accounts/destination", role: "MANAGER" }, complete: true, locations: [] },
})
const transfer = googleLifecycleRequestSchema.parse({ operation: "transfer_location", payload: { destinationAccount: "accounts/destination" } })
const deletion = googleLifecycleRequestSchema.parse({ operation: "delete_location", payload: {} })
const transferred = googleLifecycleObservationSchema.parse({ observedAt: "2026-09-30T10:01:00.000Z",
  source: { ...baseline.source, locations: [] }, destination: { ...baseline.destination, locations: [location] }, locationRead: { state: "accessible", location },
})
const removed = googleLifecycleObservationSchema.parse({ ...transferred, destination: null, locationRead: { state: "not_found" } })

describe("operation-specific Google lifecycle evidence", () => {
  it("keeps observation time outside approval state while binding role, target and eligibility", () => {
    expect(lifecycleBaselineState({ ...baseline, observedAt: "2026-09-30T11:00:00.000Z" })).toEqual(lifecycleBaselineState(baseline))
    expect(lifecycleBaselineState({ ...baseline, location: { ...location, canDelete: false } })).not.toEqual(lifecycleBaselineState(baseline))
    expect(lifecycleBaselineState({ ...baseline, source: { ...baseline.source, account: { ...baseline.source.account, role: "MANAGER" } } })).not.toEqual(lifecycleBaselineState(baseline))
  })
  it("rejects arbitrary target/body fields", () => {
    expect(googleLifecycleRequestSchema.safeParse({ operation: "delete_location", payload: { name: "locations/other" } }).success).toBe(false)
    expect(googleLifecycleRequestSchema.safeParse({ operation: "transfer_location", payload: { destinationAccount: "accounts/destination/admins/other" } }).success).toBe(false)
  })
  it("requires source ownership and destination management before transfer", () => {
    expect(lifecyclePreflightReason(transfer, baseline)).toBeNull()
    expect(lifecyclePreflightReason(transfer, { ...baseline, source: { ...baseline.source, account: { ...baseline.source.account, role: "MANAGER" } } })).toBe("source_ownership_required")
    expect(lifecyclePreflightReason(transfer, { ...baseline, destination: { ...transferred.source, account: { name: "accounts/destination", role: "SITE_MANAGER" } } })).toBe("destination_management_required")
  })
  it.each([false, null])("requires explicitly observed deletion eligibility: %s", (canDelete) => {
    expect(lifecyclePreflightReason(deletion, { ...baseline, location: { ...location, canDelete } })).toBe("deletion_eligibility_unproven")
  })
  it("requires complete source and destination inventories, never a partial first page", () => {
    expect(lifecyclePreflightReason(transfer, { ...baseline, source: { ...baseline.source, complete: false } })).toBe("source_membership_unproven")
    expect(lifecycleConfirmation({ request: transfer, baseline, observation: { ...transferred, destination: { ...transferred.source, account: { name: "accounts/destination", role: "MANAGER" }, locations: [location], complete: false } } })).toBe("unresolved")
  })
  it("confirms exact transfer membership and identity independently", () => {
    expect(lifecycleConfirmation({ request: transfer, baseline, observation: transferred })).toBe("location_transferred_between_accounts")
    expect(lifecycleConfirmation({ request: transfer, baseline, observation: { ...transferred, locationRead: { state: "forbidden" } } })).toBe("unresolved")
    expect(lifecycleConfirmation({ request: transfer, baseline, observation: { ...transferred, destination: { ...transferred.source, account: { name: "accounts/destination", role: "MANAGER" }, locations: [{ ...location, placeId: "other-place" }] } } })).toBe("unresolved")
    expect(lifecycleConfirmation({ request: transfer, baseline, observation: { ...transferred, source: baseline.source } })).toBe("unresolved")
  })
  it("records managed-account absence without claiming public place removal", () => {
    expect(lifecycleConfirmation({ request: deletion, baseline, observation: removed })).toBe("location_absent_from_managed_account")
    expect(lifecycleConfirmation({ request: deletion, baseline, observation: { ...removed, locationRead: { state: "forbidden" } } })).toBe("unresolved")
    expect(lifecycleConfirmation({ request: deletion, baseline, observation: { ...removed, source: { ...removed.source, account: { ...removed.source.account, role: null } } } })).toBe("unresolved")
    expect(lifecycleConfirmation({ request: deletion, baseline, observation: { ...removed, source: { ...removed.source, complete: false } } })).toBe("unresolved")
  })
})
