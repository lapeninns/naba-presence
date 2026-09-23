import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ProfileTab } from "@/components/locations/profile/profile-editor"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const field = (
  key: string,
  status: string,
  canonicalValue: string | null,
  googleValue: string | null,
  policy = "bidirectional"
) => ({
  key,
  policy,
  status,
  canonicalValue,
  googleValue,
  canonicalHash: "c",
  googleHash: "g",
  lastReconciledAt: null,
})

const PROFILE = {
  profile: {
    location: {
      id: "loc-1",
      name: "Camden Hotel",
      googleLocationName: "locations/camden",
    },
    canonicalResource: { revision: "3", updatedAt: "2026-08-01T00:00:00.000Z" },
    canonicalHash: "c".repeat(64),
    googleHash: "d".repeat(64),
    canPublish: true,
    googleWritesEnabled: true,
    fields: [
      field("name", "in_sync", "Camden Hotel", "Camden Hotel"),
      field("description", "in_sync", "A calm stay", "A calm stay"),
      field("phone", "in_sync", "+44 20 7946 0000", "+44 20 7946 0000"),
      field("website", "in_sync", "https://camden.test", "https://camden.test"),
      field("address", "in_sync", "1 River Rd", "1 River Rd", "import_only"),
      field("mapsUrl", "in_sync", null, null, "import_only"),
      field("reviewUrl", "in_sync", null, null, "import_only"),
    ],
    googleDetails: { primaryCategory: "Hotel", additionalCategories: [] },
    latestAttempt: null,
  },
}

const BUSINESS = {
  businessInformation: {
    location: {
      title: "Camden Hotel",
      profile: { description: "A calm stay" },
      websiteUri: "https://camden.test",
      storeCode: "CAMDEN-1",
      openInfo: { status: "OPEN" },
      labels: ["hotel"],
      serviceItems: [{ foo: 1 }],
      categories: {
        primaryCategory: {
          name: "categories/gcid:hotel",
          displayName: "Hotel",
        },
      },
    },
    attributes: {
      name: "locations/camden/attributes",
      attributes: [{ name: "attributes/wifi", values: [false] }],
    },
    attributeMetadata: [
      {
        parent: "attributes/wifi",
        displayName: "Wi-Fi",
        groupDisplayName: "Amenities",
        valueType: "BOOL",
      },
    ],
    locationHash: "a".repeat(64),
    attributesHash: "b".repeat(64),
    canPublish: true,
    writesEnabled: true,
  },
}

function stubRoutes(overrides?: { caps?: unknown; business?: unknown }) {
  const fetchMock = vi.fn(async (...args: [RequestInfo, RequestInit?]) => {
    const url = String(args[0])
    if (url.includes("/capabilities"))
      return jsonResponse({
        capabilities: overrides?.caps ?? {
          canEditCanonical: true,
          canPublish: true,
        },
      })
    if (url.includes("/business-information"))
      return jsonResponse(overrides?.business ?? BUSINESS)
    if (url.includes("/profile")) return jsonResponse(PROFILE)
    if (url.includes("/import-review"))
      return jsonResponse({ items: [], counts: {} })
    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ProfileTab", () => {
  it("shows the name once, with one primary action instead of two save models", async () => {
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    // The name used to appear on both the Profile tab and the Business info
    // tab, each with its own save button writing through a different path.
    expect(
      await screen.findByRole("textbox", { name: "Business name" })
    ).toHaveValue("Camden Hotel")
    expect(screen.getByText("Hotel")).toBeInTheDocument() // humanised, not the gcid
    expect(screen.queryByText(/gcid:/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Review changes" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull()
    // serviceItems has no editor -> the read-only pressure valve names it.
    expect(screen.getByText(/can edit yet/i)).toBeInTheDocument()
  })

  it("keeps the editor readable but not editable for a member", async () => {
    stubRoutes({ caps: { canEditCanonical: false, canPublish: false } })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(
      await screen.findByRole("textbox", { name: "Business name" })
    ).toBeDisabled()
    expect(
      screen.getAllByText("Only owners and admins can edit this location.")
        .length
    ).toBeGreaterThan(0)
  })

  it("does not crash picking an additional category when no primary category is set", async () => {
    // A location can read back with `categories.additionalCategories` but no
    // `primaryCategory` — neither is required on GET. Regression for a bare
    // `draft.primaryCategory!.name` assertion in buildLocationUpdate.
    const fetchMock = vi.fn(async (...args: [RequestInfo, RequestInit?]) => {
      const url = String(args[0])
      if (url.includes("/capabilities"))
        return jsonResponse({
          capabilities: { canEditCanonical: true, canPublish: true },
        })
      if (url.includes("type=categories"))
        return jsonResponse({
          result: {
            categories: [
              { name: "categories/gcid:spa", displayName: "Spa" },
            ],
          },
        })
      if (url.includes("/business-information"))
        return jsonResponse({
          businessInformation: {
            ...BUSINESS.businessInformation,
            location: {
              ...BUSINESS.businessInformation.location,
              categories: {
                additionalCategories: [
                  { name: "categories/gcid:pool", displayName: "Pool" },
                ],
              },
            },
          },
        })
      if (url.includes("/profile")) return jsonResponse(PROFILE)
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(await screen.findByText("No primary category set.")).toBeInTheDocument()

    const addInput = screen.getByLabelText("Add another category")
    await waitFor(() => expect(addInput).toBeEnabled())
    await userEvent.type(addInput, "spa")
    await userEvent.click(await screen.findByRole("option", { name: "Spa" }))

    expect(await screen.findByText("Spa")).toBeInTheDocument()
    expect(screen.getByText("No primary category set.")).toBeInTheDocument()
  })

  it("publishes only the touched Google field, with its mask and hash", async () => {
    const fetchMock = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")

    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const sheet = await screen.findByRole("dialog")
    await userEvent.click(
      await within(sheet).findByRole("button", { name: "Publish to Google" })
    )

    await waitFor(() => {
      const patch = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit)?.method === "PATCH" &&
          String(url).includes("/business-information")
      )
      expect(patch).toBeTruthy()
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_location")
      expect(body.confirmation).toBe("publish_business_information_to_google")
      expect(body.updateMask).toEqual(["storeCode"])
      expect(body.payload).toEqual({ storeCode: "CAMDEN-2" })
      expect(body.expectedGoogleHash).toBe("a".repeat(64))
    })
  })
})

describe("ProfileTab address lines", () => {
  it("lets an operator type spaces and new lines in the address", async () => {
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const address = await screen.findByRole("textbox", { name: "Address lines" })
    await waitFor(() => expect(address).toBeEnabled())
    await userEvent.type(address, "12 High Street{Enter}Old Town")
    // The draft keeps clean lines; the textarea keeps what was typed.
    expect(address).toHaveValue("12 High Street\nOld Town")
  })
})

describe("ProfileTab while Google's half is still loading", () => {
  it("does not claim the listing is in sync before Google has answered", async () => {
    // The four NabaPresence fields match Google in this fixture, so `rows` is
    // empty — but categories, address, open status and attributes have not
    // been fetched. Claiming "In sync with Google" here was worse than saying
    // nothing: the page asserted everything was fine, then grew by seven
    // controls a second later.
    const fetchMock = vi.fn(async (...args: [RequestInfo, RequestInit?]) => {
      const url = String(args[0])
      if (url.includes("/capabilities"))
        return jsonResponse({
          capabilities: { canEditCanonical: true, canPublish: true },
        })
      if (url.includes("/business-information")) return new Promise(() => {}) // never settles
      if (url.includes("/profile")) return jsonResponse(PROFILE)
      return jsonResponse({})
    })
    vi.stubGlobal("fetch", fetchMock)

    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(
      await screen.findByRole("textbox", { name: "Business name" })
    ).toBeInTheDocument()

    expect(screen.queryByText("In sync with Google")).toBeNull()
    expect(screen.queryByText("Everything on this page matches Google.")).toBeNull()
    expect(
      screen.getByText(/Reading categories, address and attributes from Google/i)
    ).toBeInTheDocument()
  })

  it("never asks Google for industry data a listing cannot have", async () => {
    // Seven paced Google calls, ~3.4s, every one of which fails for an
    // ordinary business. Google omits canOperateLodgingData/canOperateHealthData
    // for exactly those listings, and the fixture's metadata omits both.
    const fetchMock = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([url]) => String(url).includes("/industry"))
      ).toBe(false)
    )
  })
})
