import { afterEach, expect, it, vi } from "vitest"
import { screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SavedListingReviews } from "@/components/locations/profile/sections/saved-listing-reviews"
import { renderWithProviders } from "../helpers/render"

afterEach(() => vi.unstubAllGlobals())

it.each([false, true])("saved relationship review preserves exact approved fields with canApprove=%s", async (canApprove) => {
  const review = {
    id: "00000000-0000-4000-8000-000000000025", locationName: "Camden Hotel", payloadHash: "a".repeat(64), baselineHash: "b".repeat(64),
    baseline: { relationshipData: { parentChain: "chains/123", parentLocation: { placeId: "ChIJ_parent", relationType: "DEPARTMENT_OF" }, childrenLocations: [{ placeId: "ChIJ_child", relationType: "DEPARTMENT_OF" }] } },
    payload: { relationshipData: { parentChain: "chains/456", parentLocation: {} } }, updateMask: ["relationshipData.parentChain", "relationshipData.parentLocation"],
    requestedBy: "requester", approvedBy: null, requiresSecondApprover: true, canApprove, expiresAt: "2027-01-01T00:00:00Z",
  }
  const calls: { method: string; body: unknown }[] = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const body = method === "POST" ? { changeSet: { ...review, approvedBy: "reviewer" } } : method === "PATCH" ? { id: "relationship-attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed" } : { changeSets: [review] }
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }))
  renderWithProviders(<SavedListingReviews locationId="location" enabled />)
  await userEvent.click(await screen.findByRole("button", { name: "Review 2 saved profile fields" }))
  const dialog = await screen.findByRole("dialog")
  for (const text of ["chains/123", "chains/456", "ChIJ_parent (Department)", "Not set"]) expect(within(dialog).getByText(text, { exact: true })).toBeInTheDocument()
  expect(within(dialog).queryByText(/ChIJ_child/)).not.toBeInTheDocument()
  const publish = within(dialog).getByRole("button", { name: "Publish to Google" })
  if (!canApprove) {
    expect(publish).toBeDisabled()
    expect(calls.every((call) => call.method === "GET")).toBe(true)
  } else {
    await userEvent.click(publish)
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toBeDefined())
    expect(calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual(["POST", "PATCH"])
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ payload: review.payload, updateMask: review.updateMask, changeSetId: review.id, expectedGoogleHash: review.baselineHash })
  }
})

it.each([
  [false, "date"], [true, "date"], [false, "phones"], [true, "phones"],
  [false, "areas"], [true, "areas"],
] as const)("saved profile review honours canApprove=%s for %s", async (canApprove, kind) => {
  const review = {
    id: "00000000-0000-4000-8000-000000000015", locationName: "Camden Hotel", payloadHash: "a".repeat(64), baselineHash: "b".repeat(64),
    baseline: kind === "areas" ? { serviceArea: { businessType: "CUSTOMER_AND_BUSINESS_LOCATION", regionCode: "GB" }, storefrontAddress: { regionCode: "GB", addressLines: ["10 High Street"] } } : kind === "phones" ? { phoneNumbers: { primaryPhone: "111", additionalPhones: ["222", "333"] } } : { openInfo: { status: "OPEN", openingDate: { year: 2000, month: 3, day: 1 } } },
    payload: kind === "areas" ? { serviceArea: { businessType: "CUSTOMER_LOCATION_ONLY", regionCode: "GB", places: { placeInfos: [{ placeName: "Ely", placeId: "ChIJ_ely" }] } }, storefrontAddress: {} } : kind === "phones" ? { phoneNumbers: { primaryPhone: "111", additionalPhones: [] } } : { openInfo: { status: "OPEN", openingDate: { year: 2001, month: 4 } } }, updateMask: kind === "areas" ? ["serviceArea", "storefrontAddress"] : [kind === "phones" ? "phoneNumbers" : "openInfo.openingDate"],
    requestedBy: "requester", approvedBy: null, requiresSecondApprover: true, canApprove, expiresAt: "2027-01-01T00:00:00Z",
  }
  const calls: { method: string; body: unknown }[] = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const body = method === "POST" ? { changeSet: { ...review, approvedBy: "reviewer" } } : method === "PATCH" ? { id: "attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed" } : { changeSets: [review] }
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }))
  renderWithProviders(<SavedListingReviews locationId="location" enabled />)
  await userEvent.click(await screen.findByRole("button", { name: kind === "areas" ? "Review 2 saved profile fields" : "Review 1 saved profile field" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText(kind === "areas" ? "Customer locations only; GB; Ely (ChIJ_ely)" : kind === "phones" ? "111" : "April 2001", { exact: true })).toBeInTheDocument()
  if (kind === "areas") {
    expect(within(dialog).getByText("10 High Street", { exact: true })).toBeInTheDocument()
    expect(within(dialog).getByText("Not set", { exact: true })).toBeInTheDocument()
  }
  if (kind === "phones") expect(within(dialog).getByText("111, 222, 333", { exact: true })).toBeInTheDocument()
  const publish = within(dialog).getByRole("button", { name: "Publish to Google" })
  if (!canApprove) {
    expect(publish).toBeDisabled()
    expect(calls.every((call) => call.method === "GET")).toBe(true)
  } else {
    await userEvent.click(publish)
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toBeDefined())
    expect(calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual(["POST", "PATCH"])
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ payload: review.payload, updateMask: review.updateMask, changeSetId: review.id, expectedGoogleHash: review.baselineHash })
  }
})
