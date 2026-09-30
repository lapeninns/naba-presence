import { beforeEach, describe, expect, it, vi } from "vitest"
import { googleLifecycleRequestSchema } from "@/lib/contracts/google-lifecycle"
import type { Session } from "@/lib/server/session"

vi.mock("@/lib/server/google-administration-state", () => ({ currentAdministrationContext: vi.fn() }))
vi.mock("@/lib/server/google", () => ({ getGoogleLocation: vi.fn(), googleAccountManagementApi: vi.fn(), googleLocations: vi.fn() }))
import { currentAdministrationContext } from "@/lib/server/google-administration-state"
import { getGoogleLocation, googleAccountManagementApi, googleLocations } from "@/lib/server/google"
import { observeLifecycleBaseline, observeLifecyclePostcondition } from "@/lib/server/google-lifecycle-observation"
import { ApiError } from "@/lib/server/http"

const session: Session = { sessionId: "session", userId: "owner", organisationId: "org", organisationName: "Fixture", displayName: "Owner", email: "owner@example.test", role: "owner", canPublish: true }
const request = googleLifecycleRequestSchema.parse({ operation: "transfer_location", payload: { destinationAccount: "accounts/destination" } })
const providerLocation = { name: "locations/listing", metadata: { placeId: "place-listed", canDelete: true } }
const context = vi.mocked(currentAdministrationContext), locations = vi.mocked(googleLocations), account = vi.mocked(googleAccountManagementApi), location = vi.mocked(getGoogleLocation)

beforeEach(() => {
  vi.resetAllMocks()
  context.mockResolvedValue({ organisationId: "org", locationId: "listing", locationName: "Fixture listing", timezone: "Europe/London", externalLocationId: "external", googleConnectionId: "connection", googleAccountName: "accounts/source", googleAccountId: "source", googleLocationName: "locations/listing", canPublish: true, accessToken: async () => "fixture-token", connectionId: "connection", accountName: "accounts/source", credentialGeneration: 0 })
  account.mockImplementation(async (_token, input) => ({ name: input.path, role: input.path === "accounts/source" ? "OWNER" : "MANAGER" }))
  locations.mockImplementation(async (_token, name) => ({ locations: name === "accounts/source" ? [providerLocation] : [] }))
  location.mockResolvedValue(providerLocation)
})

describe("complete independent lifecycle account observation", () => {
  it("reads every account page before recording complete inventory", async () => {
    locations.mockImplementation(async (_token, name, page) => name === "accounts/source"
      ? page ? { locations: [providerLocation] } : { locations: [{ name: "locations/other" }], nextPageToken: "next" }
      : { locations: [] })
    const { baseline } = await observeLifecycleBaseline(session, "listing", request)
    expect(baseline.source.complete).toBe(true)
    expect(baseline.source.locations.map((row) => row.name)).toEqual(["locations/listing", "locations/other"])
    expect(locations).toHaveBeenCalledWith("fixture-token", "accounts/source", "next", { connectionKey: "connection" })
    expect(baseline.destination?.account).toEqual({ name: "accounts/destination", role: "MANAGER" })
  })
  it("rejects repeated pages instead of declaring a partial inventory complete", async () => {
    locations.mockResolvedValue({ locations: [], nextPageToken: "loop" })
    await expect(observeLifecycleBaseline(session, "listing", request)).rejects.toMatchObject({ code: "lifecycle_inventory_incomplete" })
  })
  it("rejects duplicate location identities across pages", async () => {
    locations.mockImplementation(async (_token, name, page) => name === "accounts/source" ? { locations: [providerLocation], ...(page ? {} : { nextPageToken: "next" }) } : { locations: [] })
    await expect(observeLifecycleBaseline(session, "listing", request)).rejects.toMatchObject({ code: "lifecycle_inventory_unreadable" })
  })
  it("rejects a provider account or location identity mismatch", async () => {
    account.mockResolvedValue({ name: "accounts/unrelated", role: "OWNER" })
    await expect(observeLifecycleBaseline(session, "listing", request)).rejects.toMatchObject({ code: "lifecycle_account_unreadable" })
    account.mockImplementation(async (_token, input) => ({ name: input.path, role: "OWNER" }))
    location.mockResolvedValue({ name: "locations/unrelated" })
    await expect(observeLifecycleBaseline(session, "listing", request)).rejects.toMatchObject({ code: "lifecycle_location_unreadable" })
  })
  it("keeps unknown provider role and deletion eligibility unknown", async () => {
    account.mockImplementation(async (_token, input) => ({ name: input.path, role: "NEW_PROVIDER_ROLE" }))
    location.mockResolvedValue({ name: "locations/listing" })
    const { baseline } = await observeLifecycleBaseline(session, "listing", request)
    expect(baseline.source.account.role).toBeNull()
    expect(baseline.location.canDelete).toBeNull()
  })
  it.each([[404, "not_found"], [403, "forbidden"], [503, "unavailable"]])("distinguishes location read status %s from successful removal", async (status, state) => {
    const { baseline } = await observeLifecycleBaseline(session, "listing", request)
    location.mockRejectedValue(new ApiError(Number(status), "fixture_error", "Fixture provider read"))
    const observed = await observeLifecyclePostcondition(session, "listing", { request, connectionId: "connection", credentialGeneration: 0, observedAt: baseline.observedAt }, baseline)
    expect(observed.locationRead.state).toBe(state)
    expect(observed.source.locations).toHaveLength(1)
  })
})
