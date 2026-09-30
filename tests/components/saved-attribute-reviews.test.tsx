import { afterEach, expect, it, vi } from "vitest"
import { screen, within, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { SavedAttributeReviews } from "@/components/locations/profile/sections/saved-attribute-reviews"
import { renderWithProviders } from "../helpers/render"

afterEach(() => vi.unstubAllGlobals())
it.each([false, true])("saved attribute review honours canApprove=%s", async (canApprove) => {
  const review = {
    id: "00000000-0000-4000-8000-000000000016", locationName: "Camden Hotel", payloadHash: "a".repeat(64), baselineHash: "b".repeat(64),
    baseline: { attributes: [{ name: "attributes/wifi", values: [false] }] }, payload: { attributes: [] }, updateMask: ["attributes/wifi"],
    requestedBy: "requester", approvedBy: null, requiresSecondApprover: true, canApprove, expiresAt: "2027-01-01T00:00:00Z",
  }
  const calls: { method: string; body: unknown }[] = []
  vi.stubGlobal("fetch", vi.fn(async (_url: RequestInfo, init?: RequestInit) => {
    const method = init?.method ?? "GET"
    calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null })
    const body = method === "POST" ? { changeSet: { ...review, approvedBy: "reviewer" } } : method === "PATCH" ? { id: "attempt", status: "succeeded", idempotent: false, confirmationState: "confirmed" } : { changeSets: [review] }
    return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })
  }))
  renderWithProviders(<SavedAttributeReviews locationId="location" enabled metadata={[{ parent: "attributes/wifi", displayName: "Wi-Fi", valueType: "BOOL" }]} />)
  await userEvent.click(await screen.findByRole("button", { name: "Review 1 saved attribute" }))
  const dialog = await screen.findByRole("dialog")
  expect(within(dialog).getByText("No", { exact: true })).toBeVisible()
  expect(within(dialog).getByText("Not set", { exact: true })).toBeVisible()
  const publish = within(dialog).getByRole("button", { name: "Publish to Google" })
  if (!canApprove) {
    expect(publish).toBeDisabled()
    expect(calls.every((call) => call.method === "GET")).toBe(true)
  } else {
    await userEvent.click(publish)
    await waitFor(() => expect(calls.find((call) => call.method === "PATCH")).toBeDefined())
    expect(calls.filter((call) => call.method !== "GET").map((call) => call.method)).toEqual(["POST", "PATCH"])
    expect(calls.find((call) => call.method === "POST")?.body).toMatchObject({ resourceType: "attributes", changeSetId: review.id })
    expect(calls.find((call) => call.method === "PATCH")?.body).toMatchObject({ attributes: [], attributeMask: review.updateMask, changeSetId: review.id, expectedGoogleHash: review.baselineHash })
  }
})
