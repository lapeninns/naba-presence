import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { BusinessInformationTab } from "@/components/locations/business-information-tab"

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const STATE = {
  businessInformation: {
    location: { title: "Camden Hotel", profile: { description: "A calm stay" }, websiteUri: "https://camden.test", storeCode: "CAMDEN-1", openInfo: { status: "OPEN" }, labels: ["hotel"], serviceItems: [{ foo: 1 }], categories: { primaryCategory: { name: "categories/gcid:hotel", displayName: "Hotel" } } },
    attributes: { name: "locations/camden/attributes", attributes: [{ name: "attributes/wifi", values: [false] }] },
    attributeMetadata: [{ parent: "attributes/wifi", displayName: "Wi-Fi", groupDisplayName: "Amenities", valueType: "BOOL" }],
    locationHash: "a".repeat(64), attributesHash: "b".repeat(64), canPublish: true, writesEnabled: true,
  },
}

function stubRoutes(overrides?: { caps?: unknown }) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: overrides?.caps ?? { canEditCanonical: true, canPublish: true } })
    if (url.includes("/business-information")) return jsonResponse(STATE)
    return jsonResponse({})
  }))
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe("BusinessInformationTab", () => {
  it("renders humanised identity fields and the §12 pressure valve for unsupported data", async () => {
    stubRoutes()
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    expect(await screen.findByDisplayValue("Camden Hotel")).toBeInTheDocument()
    expect(screen.getByText("Hotel")).toBeInTheDocument() // humanised category, not the gcid
    expect(screen.queryByText(/gcid:/)).not.toBeInTheDocument()
    // serviceItems has no editor -> read-only pressure valve.
    expect(screen.getAllByText(/not editable here yet/i).length).toBeGreaterThan(0)
  })

  it("hides editing for a member (read-open, edit-gated)", async () => {
    stubRoutes({ caps: { canEditCanonical: false, canPublish: false } })
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    expect(await screen.findByDisplayValue("Camden Hotel")).toBeDisabled()
    expect(await screen.findByText("Only owners and admins can edit this location.")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Camden Hotel")).toBeDisabled()
  })

  it("does not crash picking an additional category when no primary category is set", async () => {
    // A location can read back with `categories.additionalCategories` but no
    // `primaryCategory` — neither is required on GET. Regression for a bare
    // `draft.primaryCategory!.name` assertion in buildLocationUpdate that
    // threw when only additionalCategories was touched.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input)
        if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
        if (url.includes("type=categories")) {
          return jsonResponse({ result: { categories: [{ name: "categories/gcid:spa", displayName: "Spa" }] } })
        }
        if (url.includes("/business-information")) {
          return jsonResponse({
            businessInformation: {
              ...STATE.businessInformation,
              location: {
                ...STATE.businessInformation.location,
                categories: { additionalCategories: [{ name: "categories/gcid:pool", displayName: "Pool" }] },
              },
            },
          })
        }
        return jsonResponse({})
      })
    )
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    await screen.findByDisplayValue("Camden Hotel")
    expect(screen.getByText("No primary category set.")).toBeInTheDocument()

    // Editors stay disabled until the capabilities query has answered.
    const addInput = screen.getByLabelText("Add another category")
    await waitFor(() => expect(addInput).toBeEnabled())
    await userEvent.type(addInput, "spa")
    const option = await screen.findByRole("option", { name: "Spa" })
    await userEvent.click(option)

    // Selecting the additional category must not throw; it renders as a badge.
    expect(await screen.findByText("Spa")).toBeInTheDocument()
    expect(screen.getByText("No primary category set.")).toBeInTheDocument()
  })

  it("publishes only the touched field with its mask, strict payload, and locationHash", async () => {
    stubRoutes()
    const fetchSpy = vi.mocked(fetch)
    renderWithProviders(<BusinessInformationTab locationId="loc-1" />)
    const title = await screen.findByDisplayValue("Camden Hotel")
    await waitFor(() => expect(title).toBeEnabled())
    await userEvent.clear(title)
    await userEvent.type(title, "Camden Boutique Hotel")
    await userEvent.click(screen.getByRole("button", { name: /publish/i }))
    // confirm in the GoogleDiff dialog
    await userEvent.click(await screen.findByRole("button", { name: "Publish" }))
    await waitFor(() => {
      const patch = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit)?.method === "PATCH")
      expect(patch).toBeTruthy()
      const body = JSON.parse((patch![1] as RequestInit).body as string)
      expect(body.operation).toBe("update_location")
      expect(body.confirmation).toBe("publish_business_information_to_google")
      expect(body.updateMask).toEqual(["title"])
      expect(body.payload).toEqual({ title: "Camden Boutique Hotel" })
      expect(body.expectedGoogleHash).toBe("a".repeat(64))
    })
  })
})
