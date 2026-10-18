import { useQueryClient } from "@tanstack/react-query"
import { fireEvent, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ProfileTab } from "@/components/locations/profile/profile-editor"
import { locationFieldCapabilities } from "@/lib/domain/google-capabilities"
import { businessInformationPreviewSchema } from "@/lib/contracts/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { emptyListingSummary } from "@/lib/contracts/location-summary"

// The lodging editor is loaded on demand (next/dynamic). Transforming its
// module graph the first time can take longer than a query's wait on a
// loaded machine, so it is imported once up front: the tests then wait only
// for what the UI does.
beforeAll(async () => {
  await import("@/components/locations/profile/sections/industry-editor")
})

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

function stubRoutes(overrides?: { caps?: unknown; business?: unknown; saveFailure?: boolean }) {
  let reviewed: GbpChangeSet | null = null
  const fetchMock = vi.fn(async (...args: [RequestInfo, RequestInit?]) => {
    const url = String(args[0])
    if (url.includes("/industry") && url.includes("type=workflows"))
      return jsonResponse({ items: [], nextCursor: null })
    if (url.includes("/capabilities"))
      return jsonResponse({
        capabilities: overrides?.caps ?? {
          canEditCanonical: true,
          canPublish: true,
        },
      })
    if (url.includes("/business-information") && args[1]?.method === "PUT") {
      const body = businessInformationPreviewSchema.parse(
        JSON.parse(String(args[1].body))
      )
      reviewed = {
        id: "00000000-0000-4000-8000-000000000013",
        locationName: "Camden Hotel",
        payloadHash: "e".repeat(64),
        baselineHash: body.expectedGoogleHash,
        payload: body.payload,
        baseline: BUSINESS.businessInformation.location,
        updateMask: body.updateMask,
        requestedBy: "owner",
        approvedBy: null,
        requiresSecondApprover: false,
        canApprove: true,
        expiresAt: "2027-01-01T00:00:00Z",
      }
      return jsonResponse({ changeSet: reviewed })
    }
    if (url.includes("/business-information") && args[1]?.method === "POST")
      return jsonResponse({ changeSet: { ...reviewed, approvedBy: "owner" } })
    if (url.includes("/business-information") && args[1]?.method === "PATCH")
      return jsonResponse({
        id: "attempt",
        status: "succeeded",
        idempotent: false,
        confirmationState: "confirmed",
        executionState: "accepted",
      })
    if (url.includes("type=reviews"))
      return jsonResponse({ changeSets: reviewed ? [reviewed] : [] })
    if (url.includes("/business-information"))
      return jsonResponse(overrides?.business ?? BUSINESS)
    if (url.includes("/profile") && args[1]?.method === "PUT" && overrides?.saveFailure) return jsonResponse({ error: "http_error" }, 503)
    if (url.includes("/profile")) return jsonResponse(PROFILE)
    if (url.includes("/import-review"))
      return jsonResponse({ items: [], counts: {} })
    return jsonResponse({})
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

/**
 * The saved-review routes a custom fetch stub needs so "Review changes" can
 * freeze a change set and publishing can approve it before the Google write.
 */
function reviewRoute(url: string, init: RequestInit | undefined, state: { reviewed: GbpChangeSet | null; attributes?: GbpChangeSet | null }) {
  if (url.includes("/industry") && url.includes("type=workflows")) return jsonResponse({ items: [], nextCursor: null })
  if (url.includes("type=reviews")) return jsonResponse({ changeSets: state.reviewed ? [state.reviewed] : [] })
  if (url.includes("type=attribute_reviews")) return jsonResponse({ changeSets: state.attributes ? [state.attributes] : [] })
  if (!url.includes("/business-information")) return null
  const raw = init?.body ? JSON.parse(String(init.body)) : {}
  if (init?.method === "PUT" && raw.operation === "update_attributes") {
    state.attributes = {
      id: "00000000-0000-4000-8000-000000000014",
      locationName: "Camden Hotel",
      payloadHash: "d".repeat(64),
      baselineHash: raw.expectedGoogleHash,
      payload: { attributes: raw.attributes },
      baseline: { attributes: [] },
      updateMask: raw.attributeMask,
      requestedBy: "owner",
      approvedBy: null,
      requiresSecondApprover: false,
      canApprove: true,
      expiresAt: "2027-01-01T00:00:00Z",
    }
    return jsonResponse({ changeSet: state.attributes })
  }
  if (init?.method === "POST" && raw.resourceType === "attributes")
    return jsonResponse({ changeSet: { ...state.attributes, approvedBy: "owner" } })
  if (init?.method === "PUT") {
    const body = businessInformationPreviewSchema.parse(JSON.parse(String(init.body)))
    state.reviewed = {
      id: "00000000-0000-4000-8000-000000000013",
      locationName: "Camden Hotel",
      payloadHash: "e".repeat(64),
      baselineHash: body.expectedGoogleHash,
      payload: body.payload,
      baseline: BUSINESS.businessInformation.location,
      updateMask: body.updateMask,
      requestedBy: "owner",
      approvedBy: null,
      requiresSecondApprover: false,
      canApprove: true,
      expiresAt: "2027-01-01T00:00:00Z",
    }
    return jsonResponse({ changeSet: state.reviewed })
  }
  if (init?.method === "POST") return jsonResponse({ changeSet: { ...state.reviewed, approvedBy: "owner" } })
  return null
}

/** One answer of the Wi-Fi attribute's Yes / No / Not set choice. */
function wifiAnswer(option: string) {
  return within(screen.getByRole("radiogroup", { name: /Wi-Fi/ })).getByRole("radio", { name: option })
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ProfileTab", () => {
  it("counts lodging edits in shared status and discards them without a provider write", async () => {
    const fetchMock = stubRoutes({
      business: {
        businessInformation: {
          ...BUSINESS.businessInformation,
          location: {
            ...BUSINESS.businessInformation.location,
            metadata: { canOperateLodgingData: true },
          },
        },
      },
    })
    const original = fetchMock.getMockImplementation()
    if (!original) throw new Error("Profile fixture missing")
    fetchMock.mockImplementation(async (...args) =>
      String(args[0]).includes("/industry") &&
      !String(args[0]).includes("type=workflows")
        ? jsonResponse({
            industry: {
              lodging: { data: { pets: { petsAllowed: false } }, error: null },
              lodgingUpdated: { data: null, error: null },
              healthcareServices: { data: null, error: null },
              calls: { data: null, error: null },
              callInsights: { data: null, error: null },
              providerAttributes: { data: null, error: null },
              insuranceNetworks: { data: null, error: null },
              canManage: true,
              writesEnabled: true,
              lodgingHash: "a".repeat(64),
              lodgingChangeSets: [],
            },
          })
        : original(...args)
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const lodging = await screen.findByRole("region", {
      name: "Lodging details",
    })
    await userEvent.click(
      within(lodging).getByRole("searchbox", { name: "Find a lodging detail" })
    )
    await userEvent.paste("Pets allowed")
    // A clean profile draws no action bar.
    expect(
      screen.queryByRole("region", { name: "Editor actions" })
    ).not.toBeInTheDocument()
    await userEvent.click(
      within(
        within(lodging).getByRole("radiogroup", { name: "Pets allowed" })
      ).getByRole("radio", { name: "Yes" })
    )
    const footer = screen.getByRole("region", { name: "Editor actions" })
    expect(
      await within(footer).findByText("1 change not on Google")
    ).toBeInTheDocument()
    // Lodging has its own review: Save here is left out, with the reason.
    expect(
      within(footer).queryByRole("button", { name: "Save here" })
    ).toBeNull()
    expect(within(footer).getByRole("note")).toHaveTextContent(
      "Services and lodging are saved through their own review."
    )
    expect(
      within(footer).getByRole("button", { name: "Review lodging draft" })
    ).toBeEnabled()
    await userEvent.click(
      within(footer).getByRole("button", { name: "Discard edits" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard changes" })
    )
    await waitFor(() =>
      expect(
        within(
          within(lodging).getByRole("radiogroup", { name: "Pets allowed" })
        ).getByRole("radio", { name: "No" })
      ).toBeChecked()
    )
    // Discarded back to clean: the bar goes away again.
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: "Editor actions" })
      ).not.toBeInTheDocument()
    )
    expect(
      fetchMock.mock.calls.every(
        ([, init]) => !init?.method || init.method === "GET"
      )
    ).toBe(true)
  })

  it("keeps saved lodging outcomes available when the profile cannot load after disconnection", async () => {
    const changeSet = {
      id: "11111111-1111-4111-8111-111111111111",
      locationName: "Disconnected hotel",
      targetResourceName: "locations/hotel",
      payloadHash: "b".repeat(64),
      baselineHash: "a".repeat(64),
      payload: { pets: { petsAllowed: true } },
      baseline: { pets: { petsAllowed: false } },
      updateMask: ["pets.petsAllowed"],
      requestedBy: "owner",
      approvedBy: "owner",
      requiresSecondApprover: false,
      canApprove: true,
      expiresAt: "2020-01-01T12:00:00Z",
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        if (String(url).includes("/capabilities"))
          return jsonResponse({
            capabilities: { canEditCanonical: true, canPublish: false },
          })
        if (String(url).includes("type=workflows"))
          return jsonResponse({
            items: [
              { changeSet, attemptId: "22222222-2222-4222-8222-222222222222" },
            ],
            nextCursor: null,
          })
        return jsonResponse(
          {
            error: {
              code: "google_connection_not_found",
              message: "That connection is no longer available.",
            },
          },
          404
        )
      })
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(
      await screen.findByRole("button", { name: "Open lodging outcome" })
    ).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Send approved lodging changes" })
    ).not.toBeInTheDocument()
  })

  it("explains a Google connection it can't reach instead of loading skeletons", async () => {
    const summary = {
      ...emptyListingSummary({
        locationId: "loc-1",
        linked: true,
        verified: true,
      }),
      connection: {
        status: "expired",
        reconnectRequired: true,
        googleEmail: null,
      },
      freshness: {
        state: "action_needed",
        reason: "reconnect_required",
        lastCheckedAt: null,
      },
    }
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        const path = String(url)
        if (path.includes("/summary")) return jsonResponse({ summary })
        if (path.includes("/capabilities"))
          return jsonResponse({
            capabilities: { canEditCanonical: true, canPublish: true },
          })
        if (path.includes("type=workflows"))
          return jsonResponse({ items: [], nextCursor: null })
        // The live profile read never answers while Google is unreachable.
        if (path.includes("/profile")) return new Promise<Response>(() => {})
        return jsonResponse({ items: [], nextCursor: null })
      })
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const state = await screen.findByText(
      "Google can’t be reached for this listing"
    )
    expect(
      state.closest('[data-slot="profile-unreachable"]')
    ).toHaveTextContent(/needs reconnecting/)
    expect(
      screen.queryByText(/Reading the business profile from Google/)
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Reconnect in Settings" })
    ).toHaveAttribute("href", "/settings/connections")
    expect(
      screen.getByRole("link", { name: "See saved work" })
    ).toHaveAttribute("href", "#profile-saved-work")
    expect(document.getElementById("profile-saved-work")).toContainElement(
      screen.getByRole("region", { name: "Saved lodging work" })
    )
  })

  it("keeps eligible services read-only when the profile permission denies editing", async () => {
    const location = {
      ...BUSINESS.businessInformation.location,
      metadata: { canModifyServiceList: true },
      serviceItems: [
        {
          structuredServiceItem: {
            serviceTypeId: "job_type_id:repair",
            description: "Repairs",
          },
        },
      ],
    }
    const fetchMock = stubRoutes({
      caps: { canEditCanonical: false, canPublish: false },
      business: {
        businessInformation: {
          ...BUSINESS.businessInformation,
          location,
          capabilityDetails: locationFieldCapabilities({
            location,
            canPublish: true,
            writesEnabled: true,
            observedAt: "2026-09-29T12:00:00.000Z",
          }),
        },
      },
    })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(await screen.findByDisplayValue("Repairs")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Review service changes" })
    ).toBeDisabled()
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("type=reviews"))
    ).toBe(false)
  })
  it("uses the general Services editor for an eligible healthcare listing without a second industry request", async () => {
    const location = {
      ...BUSINESS.businessInformation.location,
      metadata: { canModifyServiceList: true, canOperateHealthData: true },
      categories: {
        primaryCategory: {
          name: "categories/gcid:doctor",
          displayName: "Doctor",
        },
      },
      serviceItems: [
        {
          freeFormServiceItem: {
            category: "gcid:doctor",
            label: {
              displayName: "Consultation",
              description: "Initial appointment",
            },
          },
        },
      ],
    }
    const fetchMock = stubRoutes({
      business: {
        businessInformation: {
          ...BUSINESS.businessInformation,
          location,
          capabilityDetails: locationFieldCapabilities({
            location,
            canPublish: true,
            writesEnabled: true,
            observedAt: "2026-09-30T12:00:00.000Z",
          }),
        },
      },
    })
    const original = fetchMock.getMockImplementation()
    if (!original) throw new Error("Healthcare fixture missing")
    fetchMock.mockImplementation(async (...args) =>
      String(args[0]).includes("type=services")
        ? jsonResponse({
            serviceMetadata: {
              categories: [
                {
                  name: "categories/gcid:doctor",
                  displayName: "Doctor",
                  serviceTypes: [],
                },
              ],
              regionCode: "GB",
              languageCode: "en",
              observedAt: "2026-09-30T12:00:00Z",
              locationHash: "a".repeat(64),
            },
          })
        : original(...args)
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(
      await screen.findByRole("textbox", { name: "Service name" })
    ).toHaveValue("Consultation")
    expect(
      await screen.findByRole("button", {
        name: "Add custom service for Doctor",
      })
    ).toBeEnabled()
    expect(
      screen.queryByText("Healthcare services", { exact: true })
    ).not.toBeInTheDocument()
    expect(
      fetchMock.mock.calls.some(
        ([url]) =>
          String(url).includes("/industry") &&
          !String(url).includes("type=workflows")
      )
    ).toBe(false)
  })

  it("shows unknown service eligibility separately from confirmed ineligibility", async () => {
    stubRoutes({
      business: {
        businessInformation: {
          ...BUSINESS.businessInformation,
          capabilityDetails: locationFieldCapabilities({
            location: BUSINESS.businessInformation.location,
            canPublish: true,
            writesEnabled: true,
            observedAt: "2026-09-29T12:00:00.000Z",
          }),
        },
      },
    })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    expect(
      await screen.findByText(
        /Services: Google eligibility has not been confirmed/
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Google does not support this action/)
    ).not.toBeInTheDocument()
  })

  it("shows the name once, with one primary action instead of two save models", async () => {
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    // The name used to appear on both the Profile tab and the Business info
    // tab, each with its own save button writing through a different path.
    expect(
      await screen.findByRole("textbox", { name: "Business name" })
    ).toHaveValue("Camden Hotel")
    expect(await screen.findByText("Hotel")).toBeInTheDocument() // humanised, not the gcid
    expect(screen.queryByText(/gcid:/)).not.toBeInTheDocument()
    // Nothing to save or publish: no action bar over the first field.
    expect(
      screen.queryByRole("region", { name: "Editor actions" })
    ).not.toBeInTheDocument()
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.type(storeCode, "X")
    // With an edit, one bar and one primary action, never a second save model.
    const footer = await screen.findByRole("region", { name: "Editor actions" })
    expect(
      within(footer).getByRole("button", { name: "Review changes" })
    ).toBeEnabled()
    expect(screen.getAllByRole("button", { name: "Review changes" })).toHaveLength(1)
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
            categories: [{ name: "categories/gcid:spa", displayName: "Spa" }],
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
    expect(
      await screen.findByText("No primary category set.")
    ).toBeInTheDocument()

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

    await userEvent.click(
      screen.getByRole("button", { name: "Review changes" })
    )
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
      expect(body.changeSetId).toBe("00000000-0000-4000-8000-000000000013")
    })
  })
})

describe("ProfileTab save here", () => {
  it("saves the copy fields even when a Google-only field is edited too, keeping that edit", async () => {
    const fetchMock = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")
    const name = screen.getByRole("textbox", { name: "Business name" })
    await userEvent.clear(name)
    await userEvent.type(name, "Camden House")

    // One write path: no section or field carries its own save-model tag;
    // the review sheet says where each change goes, once.
    expect(screen.queryByText("Saved here first")).toBeNull()
    expect(
      screen.queryByText("No draft · reviewed, then sent to Google")
    ).toBeNull()
    // Nothing on the profile claims an unreviewed write to Google.
    expect(screen.queryByText(/straight to Google/)).toBeNull()

    await userEvent.click(screen.getByRole("button", { name: "Save here" }))
    await waitFor(() => {
      const put = fetchMock.mock.calls.find(
        ([url, init]) =>
          (init as RequestInit)?.method === "PUT" &&
          String(url).includes("/profile")
      )
      expect(put).toBeTruthy()
      const body = JSON.parse((put![1] as RequestInit).body as string)
      expect(body.values.name).toBe("Camden House")
    })
    // Nothing went to Google, and the store code edit is still in the form.
    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          (init as RequestInit)?.method === "PATCH" &&
          String(url).includes("/business-information")
      )
    ).toBe(false)
    expect(screen.getByDisplayValue("CAMDEN-2")).toBeInTheDocument()
  })
})

describe("ProfileTab address lines", () => {
  it("lets an operator type spaces and new lines in the address", async () => {
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const address = await screen.findByRole("textbox", {
      name: "Address lines",
    })
    await waitFor(() => expect(address).toBeEnabled())
    await userEvent.type(address, "12 High Street{Enter}Old Town")
    // The draft keeps clean lines; the textarea keeps what was typed.
    expect(address).toHaveValue("12 High Street\nOld Town")
  })
})

describe("ProfileTab on a phone", () => {
  /** A touch phone: no `desk` (or any other) media query matches. */
  function stubPhone() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }))
    )
  }

  it("picks the open status from a sheet and still confirms permanent closure", async () => {
    stubPhone()
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const status = await screen.findByRole("button", { name: /Open status/ })
    await waitFor(() => expect(status).toBeEnabled())
    expect(status).toHaveTextContent("Open")
    await userEvent.click(status)
    const sheet = await screen.findByRole("dialog", { name: "Open status" })
    await userEvent.click(
      within(sheet).getByRole("option", { name: "Temporarily closed" })
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open status/ })).toHaveTextContent(
        "Temporarily closed"
      )
    )
    await userEvent.click(screen.getByRole("button", { name: /Open status/ }))
    const again = await screen.findByRole("dialog", { name: "Open status" })
    await userEvent.click(
      within(again).getByRole("option", { name: "Permanently closed" })
    )
    const confirm = await screen.findByRole("alertdialog", {
      name: "Mark as permanently closed?",
    })
    const mark = within(confirm).getByRole("button", {
      name: "Mark as permanently closed",
    })
    expect(mark).toBeDisabled()
    // The confirm opens after the sheet has closed, so focus ends inside it.
    expect(screen.queryByRole("dialog", { name: "Open status" })).toBeNull()
    await waitFor(() =>
      expect(confirm.contains(document.activeElement)).toBe(true)
    )
    await userEvent.click(within(confirm).getByRole("checkbox"))
    await userEvent.click(mark)
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open status/ })).toHaveTextContent(
        "Permanently closed"
      )
    )
  })
})

describe("ProfileTab on a phone: sheet focus return", () => {
  /** A touch phone: no `desk` (or any other) media query matches. */
  function stubPhone() {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }))
    )
  }
  const category = (id: string) => ({
    name: `categories/gcid:${id}`,
    displayName: id,
  })
  /** stubRoutes, plus Google's category search answering with `found`. */
  function stubWithCategories(
    additional: { name: string; displayName: string }[],
    found: { name: string; displayName: string }[]
  ) {
    const base = stubRoutes({
      business: {
        businessInformation: {
          ...BUSINESS.businessInformation,
          location: {
            ...BUSINESS.businessInformation.location,
            categories: {
              primaryCategory: category("Hotel"),
              additionalCategories: additional,
            },
          },
        },
      },
    })
    vi.stubGlobal(
      "fetch",
      vi.fn(async (...args: [RequestInfo, RequestInit?]) =>
        String(args[0]).includes("type=categories")
          ? jsonResponse({ result: { categories: found } })
          : base(...args)
      )
    )
  }

  // A tap in Safari never focuses the button it hits: fireEvent.click opens
  // the sheet without moving focus, so only `finalFocus` can bring it back.
  it("returns focus to the primary category row that opened the sheet", async () => {
    stubPhone()
    stubWithCategories([], [category("Spa")])
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const row = await screen.findByRole("button", { name: /Primary category/ })
    await waitFor(() => expect(row).toBeEnabled())
    fireEvent.click(row)
    await screen.findByRole("dialog", { name: "Change primary category" })
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Change primary category" })
      ).toBeNull()
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Primary category/ })
      ).toHaveFocus()
    )
  })

  it("returns focus to the additional category row that opened the sheet", async () => {
    stubPhone()
    stubWithCategories([], [category("Spa")])
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const row = await screen.findByRole("button", {
      name: /Add another category/,
    })
    await waitFor(() => expect(row).toBeEnabled())
    fireEvent.click(row)
    const sheet = await screen.findByRole("dialog", {
      name: "Add another category",
    })
    await userEvent.type(
      within(sheet).getByLabelText("Search Google categories"),
      "spa"
    )
    await userEvent.click(
      await within(sheet).findByRole("checkbox", { name: "Spa" })
    )
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add another category" })
      ).toBeNull()
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /Add another category/ })
      ).toHaveFocus()
    )
  })

  it("focuses the Additional categories label when the 9th category disables the opener", async () => {
    stubPhone()
    stubWithCategories(
      ["A", "B", "C", "D", "E", "F", "G", "H"].map(category),
      [category("Spa")]
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const row = await screen.findByRole("button", {
      name: /Add another category/,
    })
    await waitFor(() => expect(row).toBeEnabled())
    await userEvent.click(row)
    const sheet = await screen.findByRole("dialog", {
      name: "Add another category",
    })
    await userEvent.type(
      within(sheet).getByLabelText("Search Google categories"),
      "spa"
    )
    await userEvent.click(
      await within(sheet).findByRole("checkbox", { name: "Spa" })
    )
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Add another category" })
      ).toBeNull()
    )
    // The list is full, so the row that opened the sheet is disabled.
    expect(
      screen.getByRole("button", { name: /Add another category/ })
    ).toBeDisabled()
    await waitFor(() =>
      expect(screen.getByText("Additional categories")).toHaveFocus()
    )
    expect(screen.getByText("Additional categories")).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-(--np-focus-ring)",
      "forced-colors:focus-visible:outline-2",
      "forced-colors:focus-visible:outline-solid"
    )
    expect(document.body).not.toHaveFocus()
  })

  it("returns focus to the open status row after a choice", async () => {
    stubPhone()
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const status = await screen.findByRole("button", { name: /Open status/ })
    await waitFor(() => expect(status).toBeEnabled())
    fireEvent.click(status)
    const sheet = await screen.findByRole("dialog", { name: "Open status" })
    fireEvent.click(
      within(sheet).getByRole("option", { name: "Temporarily closed" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Open status" })).toBeNull()
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Open status/ })).toHaveFocus()
    )
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

    expect(screen.queryByText("In sync")).toBeNull()
    expect(
      screen.queryByText("Everything on this page matches Google.")
    ).toBeNull()
    expect(
      screen.getByText(
        /Reading categories, address and attributes from Google/i
      )
    ).toBeInTheDocument()
  })

  it("never asks Google for industry data a listing cannot have", async () => {
    const fetchMock = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url]) =>
            String(url).includes("/industry") &&
            !String(url).includes("type=workflows")
        )
      ).toBe(false)
    )
  })
})

describe("ProfileTab save and review boundaries", () => {
  it("explains Save here scope and requires review for provider-only edits", async () => {
    sessionStorage.clear()
    const fetcher = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")
    // Save here can't take this edit, so it is left out (not greyed).
    expect(screen.queryByRole("button", { name: "Save here" })).toBeNull()
    // The bar says why Save here can't take this edit, once (the repeated
    // save-scope paragraph is gone).
    expect(
      within(screen.getByRole("region", { name: "Editor actions" })).getByRole("note")
    ).toHaveTextContent(/Only the name, description, primary phone and website are saved here/i)
    expect(screen.queryByText("No draft · reviewed, then sent to Google")).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog")
    expect(await within(review).findByText("CAMDEN-2")).toBeInTheDocument()
    // One plain line, built from what is in the sheet.
    expect(within(review).getByText("Store code goes to Google when you publish.")).toBeInTheDocument()
    await userEvent.click(within(review).getByRole("button", { name: "Keep editing" }))
    expect(screen.getByDisplayValue("CAMDEN-2")).toBeInTheDocument()
    // Preparing a review saves it here; nothing is written to Google.
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH")).toBe(false)
    const beforeUnload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
  })

  it("reports the exact successful and failed steps after partial publication", async () => {
    sessionStorage.clear()
    const reviews = { reviewed: null as GbpChangeSet | null }
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      const review = reviewRoute(url, init, reviews)
      if (review) return review
      if (url.includes("/business-information") && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body))
        return body.operation === "update_attributes" ? jsonResponse({ error: "PERMISSION_DENIED" }, 403) : jsonResponse({ id: "m1", status: "succeeded", idempotent: false })
      }
      if (url.includes("/business-information")) return jsonResponse(BUSINESS)
      if (url.includes("/profile")) return jsonResponse(PROFILE)
      return jsonResponse({ items: [], counts: {} })
    })
    vi.stubGlobal("fetch", fetcher)
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")
    await userEvent.click(wifiAnswer("Yes"))
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog")
    await userEvent.click(await within(review).findByRole("button", { name: "Publish to Google" }))
    expect(await within(review).findByRole("button", { name: "Try again" })).toBeInTheDocument()
    const progress = within(review).getByRole("list", { name: "Publish progress" })
    // One result per changed row, from the step that carries it.
    const rows = within(progress).getAllByRole("listitem")
    const storeRow = rows.find((row) => row.textContent?.includes("Store code"))
    const wifiRow = rows.find((row) => row.textContent?.includes("Wi-Fi"))
    // Business information compares its readback before success, so the
    // finished row says live.
    expect(storeRow).toHaveTextContent("Live on Google")
    // Google's own 403 refusal is its verdict, so the row says so rather
    // than a bare "Failed" (lib/errors/action-errors.ts errorOutcome).
    expect(wifiRow).toHaveTextContent("Rejected by Google")
    expect(review).toHaveTextContent("Earlier steps were sent to Google.")
    expect(review).not.toHaveTextContent("Nothing was changed")
    expect(await within(screen.getByRole("region", { name: "Notifications" })).findByText("Publishing stopped. See the steps.")).toBeVisible()
    expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(2)
  })
})

it("keeps provider edits unsaved after a successful local save and discards only unsaved values", async () => {
  sessionStorage.clear()
  let saved = false
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
    if (url.includes("/business-information")) return jsonResponse(BUSINESS)
    if (url.includes("/profile") && init?.method === "PUT") { saved = true; return jsonResponse({ saved: true, revision: "4" }) }
    if (url.includes("/profile")) return jsonResponse(saved ? { profile: { ...PROFILE.profile, canonicalResource: { ...PROFILE.profile.canonicalResource, revision: "4" }, fields: PROFILE.profile.fields.map((entry) => entry.key === "name" ? { ...entry, canonicalValue: "Camden House", status: "core_dirty" } : entry) } } : PROFILE)
    return jsonResponse({ items: [], counts: {} })
  })
  vi.stubGlobal("fetch", fetcher)
  renderWithProviders(<ProfileTab locationId="loc-1" />)
  const storeCode = await screen.findByDisplayValue("CAMDEN-1")
  await waitFor(() => expect(storeCode).toBeEnabled())
  await userEvent.clear(storeCode)
  await userEvent.type(storeCode, "CAMDEN-2")
  const name = screen.getByRole("textbox", { name: "Business name" })
  await userEvent.clear(name)
  await userEvent.type(name, "Camden House")
  await userEvent.click(screen.getByRole("button", { name: "Save here" }))
  expect(await screen.findByText(/Other profile edits still need review and publication/)).toBeInTheDocument()
  // Nothing saveable is left, so Save here leaves the bar (it isn't greyed).
  await waitFor(() => expect(screen.queryByRole("button", { name: "Save here" })).toBeNull())
  const beforeUnload = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(beforeUnload)
  expect(beforeUnload.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole("button", { name: "Discard edits" }))
  await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }))
  expect(screen.getByDisplayValue("CAMDEN-1")).toBeInTheDocument()
  expect(screen.getByRole("textbox", { name: "Business name" })).toHaveValue("Camden House")
  expect(fetcher.mock.calls.filter(([, init]) => init?.method === "PUT")).toHaveLength(1)
  expect(fetcher.mock.calls.some(([, init]) => init?.method === "PATCH" || init?.method === "POST")).toBe(false)
})


it("retains local edits and reload protection when Save here fails", async () => {
  sessionStorage.clear()
  stubRoutes({ saveFailure: true })
  renderWithProviders(<ProfileTab locationId="loc-1" />)
  const name = await screen.findByRole("textbox", { name: "Business name" })
  await waitFor(() => expect(name).toBeEnabled())
  await userEvent.clear(name)
  await userEvent.type(name, "Unsaved business name")
  await userEvent.click(screen.getByRole("button", { name: "Save here" }))
  expect(await screen.findByText(/temporarily unavailable/)).toBeInTheDocument()
  expect(name).toHaveValue("Unsaved business name")
  expect(screen.getByRole("button", { name: "Save here" })).toBeEnabled()
  const beforeUnload = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(beforeUnload)
  expect(beforeUnload.defaultPrevented).toBe(true)
})

function RefreshProfileFixture() {
  const client = useQueryClient()
  return <button onClick={() => void client.invalidateQueries()}>Refresh fixture</button>
}

it.each(["save", "review"])("preserves dirty name after failed %s and colleague revision", async (action) => {
  sessionStorage.clear()
  let external = false
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
    if (url.includes("/business-information")) return jsonResponse(BUSINESS)
    if (url.includes("/profile") && init?.method === "PUT") return jsonResponse({ error: "http_error" }, 503)
    if (url.includes("/profile")) return jsonResponse(external ? { profile: { ...PROFILE.profile, canonicalResource: { ...PROFILE.profile.canonicalResource, revision: "4" }, fields: PROFILE.profile.fields.map((entry) => entry.key === "name" ? { ...entry, canonicalValue: "Colleague name" } : entry) } } : PROFILE)
    return jsonResponse({ items: [], counts: {} })
  }))
  renderWithProviders(<><ProfileTab locationId="loc-1" /><RefreshProfileFixture /></>)
  const name = await screen.findByRole("textbox", { name: "Business name" })
  await waitFor(() => expect(name).toBeEnabled())
  await userEvent.clear(name)
  await userEvent.type(name, "My unsaved name")
  if (action === "save") {
    await userEvent.click(screen.getByRole("button", { name: "Save here" }))
    await screen.findByText(/temporarily unavailable/)
  } else {
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog")
    await userEvent.click(await within(review).findByRole("button", { name: "Publish to Google" }))
    await within(review).findByRole("button", { name: "Try again" })
    await userEvent.click(within(review).getByRole("button", { name: "Keep editing" }))
  }
  external = true
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  await screen.findByRole("button", { name: "Load theirs" })
  expect(name).toHaveValue("My unsaved name")
  const beforeUnload = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(beforeUnload)
  expect(beforeUnload.defaultPrevented).toBe(true)
})

it.each(["listing", "attributes"])("preserves failed %s edits after partial flow and later Google snapshot", async (failedStep) => {
  sessionStorage.clear()
  let external = false
  let listingSent = false
  const reviews = { reviewed: null as GbpChangeSet | null }
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
    const review = reviewRoute(url, init, reviews)
    if (review) return review
    if (url.includes("/business-information") && init?.method === "PATCH") {
      const body = JSON.parse(String(init.body))
      if (failedStep === "listing" || body.operation === "update_attributes") return jsonResponse({ error: "PERMISSION_DENIED" }, 403)
      listingSent = true
      return jsonResponse({ id: "m1", status: "succeeded", idempotent: false })
    }
    if (url.includes("/business-information")) return jsonResponse({ businessInformation: { ...BUSINESS.businessInformation, location: { ...BUSINESS.businessInformation.location, storeCode: listingSent ? "CAMDEN-2" : external ? "COLLEAGUE" : "CAMDEN-1" }, locationHash: listingSent ? "e".repeat(64) : external ? "f".repeat(64) : BUSINESS.businessInformation.locationHash, attributesHash: external ? "f".repeat(64) : BUSINESS.businessInformation.attributesHash } })
    if (url.includes("/profile")) return jsonResponse(PROFILE)
    return jsonResponse({ items: [], counts: {} })
  }))
  renderWithProviders(<><ProfileTab locationId="loc-1" /><RefreshProfileFixture /></>)
  const store = await screen.findByDisplayValue("CAMDEN-1")
  await waitFor(() => expect(store).toBeEnabled())
  await userEvent.clear(store)
  await userEvent.type(store, "CAMDEN-2")
  await userEvent.click(wifiAnswer("Yes"))
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
  const review = await screen.findByRole("dialog")
  await userEvent.click(await within(review).findByRole("button", { name: "Publish to Google" }))
  await within(review).findByRole("button", { name: "Try again" })
  await userEvent.click(within(review).getByRole("button", { name: "Keep editing" }))
  external = true
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  await screen.findByRole("button", { name: "Load theirs" })
  expect(wifiAnswer("Yes")).toBeChecked()
  expect(store).toHaveValue("CAMDEN-2")
  if (listingSent) {
    await userEvent.click(screen.getByRole("button", { name: "Discard edits" }))
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }))
    expect(store).toHaveValue("CAMDEN-2")
    expect(wifiAnswer("Yes")).not.toBeChecked()
    expect(wifiAnswer("No")).toBeChecked()
  }
})

describe("ProfileTab section navigation", () => {
  it("lists every block on the page, in page order, with saved work after the editor", async () => {
    const savedReview: GbpChangeSet = {
      id: "00000000-0000-4000-8000-000000000031",
      locationName: "Camden Hotel",
      payloadHash: "e".repeat(64),
      baselineHash: "a".repeat(64),
      payload: { storeCode: "CAMDEN-9" },
      baseline: BUSINESS.businessInformation.location,
      updateMask: ["storeCode"],
      requestedBy: "owner",
      approvedBy: null,
      requiresSecondApprover: false,
      canApprove: true,
      expiresAt: "2027-01-01T00:00:00Z",
    }
    const fetchMock = stubRoutes()
    const original = fetchMock.getMockImplementation()
    if (!original) throw new Error("Profile fixture missing")
    fetchMock.mockImplementation(async (...args) =>
      String(args[0]).includes("type=reviews")
        ? jsonResponse({ changeSets: [savedReview] })
        : original(...args)
    )
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const nav = await screen.findByRole("navigation", { name: "Profile sections" })
    // Wait for the self-rendering blocks: Google's half, saved reviews and
    // saved lodging work.
    await within(nav).findByRole("link", { name: "Saved profile reviews" })
    await within(nav).findByRole("link", { name: "Saved lodging work" })
    await within(nav).findByRole("link", { name: "Attributes" })

    const navIds = within(nav)
      .getAllByRole("link")
      .map((link) => link.getAttribute("href")?.slice(1))
    const pageIds = Array.from(
      document.querySelectorAll<HTMLElement>('[id^="section-"]')
    )
      .map((element) => element.id)
      .filter((id) => !id.endsWith("-heading"))
    // Every block on the page is indexed, and in the order it appears.
    expect(navIds).toEqual(pageIds)
    expect(navIds).toEqual(
      expect.arrayContaining([
        "section-identity",
        "section-advertising",
        "section-chain",
        "section-attributes",
        "section-other-google-details",
        "section-saved-reviews",
        "section-saved-lodging",
      ])
    )
    // Google Ads phone sits before Chain affiliation on the page and in the nav.
    expect(navIds.indexOf("section-advertising")).toBeLessThan(navIds.indexOf("section-chain"))
    // Saved work is in one place, after the editor's content.
    const savedWork = document.getElementById("profile-saved-work")
    expect(savedWork).toContainElement(document.getElementById("section-saved-reviews"))
    expect(savedWork).toContainElement(document.getElementById("section-saved-lodging"))
    expect(navIds.indexOf("section-saved-reviews")).toBeGreaterThan(navIds.indexOf("section-other-google-details"))
    // A block that is not on the page is not offered.
    expect(document.getElementById("section-retail-products")).toBeNull()
    expect(within(nav).queryByRole("link", { name: "Product catalogue" })).toBeNull()
  })

  it("jumps to a section and focuses its heading", async () => {
    stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const nav = await screen.findByRole("navigation", { name: "Profile sections" })
    await userEvent.click(await within(nav).findByRole("link", { name: "Description" }))
    expect(document.getElementById("section-description-heading")).toHaveFocus()
    await userEvent.click(await within(nav).findByRole("link", { name: "Saved lodging work" }))
    expect(screen.getByRole("heading", { name: "Saved lodging work" })).toHaveFocus()
  })
})

it("publishes from the save's answer without fetching the profile again (W0-04)", async () => {
  sessionStorage.clear()
  const savedProfile = {
    ...PROFILE.profile,
    canonicalResource: { revision: "4", updatedAt: "2026-08-02T00:00:00.000Z" },
    canonicalHash: "e".repeat(64),
    fields: PROFILE.profile.fields.map((entry) =>
      entry.key === "name"
        ? { ...entry, status: "core_dirty", canonicalValue: "Camden House" }
        : entry
    ),
    observedAt: "2026-08-01T00:00:00.000Z",
    source: "stored",
  }
  const profileCalls: string[] = []
  let publishBody: Record<string, unknown> | null = null
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/capabilities"))
      return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
    if (url.includes("/profile") && !url.includes("/import-review")) {
      const method = init?.method ?? "GET"
      profileCalls.push(method)
      if (method === "PUT")
        return jsonResponse({ saved: true, revision: "4", profile: savedProfile })
      if (method === "POST") {
        publishBody = JSON.parse(String(init?.body))
        return jsonResponse({ status: "published", attemptId: "a1", idempotent: false })
      }
      return jsonResponse(PROFILE)
    }
    const review = reviewRoute(url, init, { reviewed: null })
    if (review) return review
    if (url.includes("/business-information")) return jsonResponse(BUSINESS)
    return jsonResponse({ items: [], counts: {} })
  })
  vi.stubGlobal("fetch", fetcher)
  renderWithProviders(<ProfileTab locationId="loc-1" />)
  const name = await screen.findByRole("textbox", { name: "Business name" })
  await waitFor(() => expect(name).toBeEnabled())
  await userEvent.clear(name)
  await userEvent.type(name, "Camden House")
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
  const review = await screen.findByRole("dialog")
  await userEvent.click(
    await within(review).findByRole("button", { name: "Publish to Google" })
  )
  await waitFor(() => expect(publishBody).not.toBeNull())
  // The save answered with the saved profile: no GET between it and the
  // publish, which carries the revision and hash that answer named.
  const put = profileCalls.indexOf("PUT")
  expect(profileCalls.slice(put, profileCalls.indexOf("POST") + 1)).toEqual([
    "PUT",
    "POST",
  ])
  expect(publishBody).toMatchObject({
    selectedFields: ["name"],
    expectedCanonicalRevision: "4",
    expectedCanonicalHash: "e".repeat(64),
  })
})

describe("ProfileTab one review sheet (L14)", () => {
  const savedProfile = {
    ...PROFILE.profile,
    canonicalResource: { revision: "4", updatedAt: "2026-08-02T00:00:00.000Z" },
    canonicalHash: "e".repeat(64),
    fields: PROFILE.profile.fields.map((entry) =>
      entry.key === "name"
        ? { ...entry, status: "core_dirty", canonicalValue: "Camden House" }
        : entry
    ),
    observedAt: "2026-08-01T00:00:00.000Z",
    source: "stored",
  }

  /** Routes for a profile whose prepared requests may need a second approver. */
  function stubCombined({ secondApprover, profileHeld = false }: { secondApprover: boolean; profileHeld?: boolean }) {
    const reviews = { reviewed: null as GbpChangeSet | null }
    const calls: { method: string; url: string }[] = []
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      calls.push({ method: init?.method ?? "GET", url })
      if (url.includes("/capabilities"))
        return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
      if (url.includes("/profile") && !url.includes("/import-review")) {
        if (init?.method === "PUT")
          return jsonResponse({ saved: true, revision: "4", profile: savedProfile })
        if (init?.method === "POST" && profileHeld)
          // Two-person mode with listing approvals on: the route parks the
          // publish (lib/server/listing-changes.ts) and answers 202.
          return jsonResponse(
            {
              status: "awaiting_approval",
              changeRequest: {
                id: "op-1",
                intentId: "intent-1",
                kind: "profile_publish",
                label: "Publish profile fields",
                locationId: "loc-1",
                target: null,
                fieldMask: ["name"],
                details: [{ label: "Business name", value: "Camden House" }],
                payloadHash: "f".repeat(64),
                outcome: "awaiting_approval",
                errorCode: null,
                author: { id: "owner", name: "Owner" },
                createdAt: "2026-08-02T00:00:00.000Z",
                updatedAt: "2026-08-02T00:00:00.000Z",
                isOwn: true,
                canDecide: false,
              },
              operation: { operationId: "op-1", outcome: "awaiting_approval" },
            },
            202
          )
        if (init?.method === "POST")
          return jsonResponse({ status: "published", attemptId: "a1", idempotent: false })
        return jsonResponse(PROFILE)
      }
      if (url.includes("/business-information") && init?.method === "PUT") {
        reviewRoute(url, init, reviews)
        if (secondApprover)
          reviews.reviewed = { ...reviews.reviewed!, requiresSecondApprover: true, canApprove: false }
        return jsonResponse({ changeSet: reviews.reviewed })
      }
      if (url.includes("/business-information") && init?.method === "PATCH")
        return jsonResponse({ id: "m1", status: "succeeded", idempotent: false, confirmationState: "confirmed", executionState: "accepted" })
      const review = reviewRoute(url, init, reviews)
      if (review) return review
      if (url.includes("/business-information")) return jsonResponse(BUSINESS)
      return jsonResponse({ items: [], counts: {} })
    })
    vi.stubGlobal("fetch", fetcher)
    return calls
  }

  async function editNameAndStoreCode({ name = true } = {}) {
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")
    if (name) {
      const field = screen.getByRole("textbox", { name: "Business name" })
      await userEvent.clear(field)
      await userEvent.type(field, "Camden House")
    }
  }

  it("lists both kinds of change in one sheet with one plain line, then sends both from one publish", async () => {
    sessionStorage.clear()
    const calls = stubCombined({ secondApprover: false })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    await editNameAndStoreCode()
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog", { name: "Review changes" })
    expect(within(review).getByText("2 changes for Camden Hotel.")).toBeInTheDocument()
    expect(
      within(review).getByText(
        "Name saves here first, then goes to Google with the store code when you publish."
      )
    ).toBeInTheDocument()
    expect(within(review).getByText("Camden House")).toBeInTheDocument()
    expect(within(review).getByText("CAMDEN-2")).toBeInTheDocument()
    // Nothing internal: no model names in the sheet.
    expect(review).not.toHaveTextContent(/No draft|canonical|change set/i)

    await userEvent.click(within(review).getByRole("button", { name: "Publish to Google" }))
    // Everything went out, so the sheet closes as before.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull())
    // In order: approve the prepared request, send it, then save the copy
    // and publish it (the business information goes first, as on main).
    const writes = calls
      .filter(({ method }) => method !== "GET")
      .map(({ method, url }) => `${method} ${new URL(url, "http://x").pathname}`)
      .filter((call) => /\/(business-information|profile)$/.test(call))
    const sent = writes.slice(writes.indexOf("POST /api/locations/loc-1/business-information"))
    expect(sent).toEqual([
      "POST /api/locations/loc-1/business-information",
      "PATCH /api/locations/loc-1/business-information",
      "PUT /api/locations/loc-1/profile",
      "POST /api/locations/loc-1/profile",
    ])
  })

  it("keeps publishing off with the existing reason when any request needs another approver", async () => {
    sessionStorage.clear()
    const calls = stubCombined({ secondApprover: true })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    await editNameAndStoreCode()
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog", { name: "Review changes" })
    // The plain line says why; the copy field doesn't unlock the button.
    expect(
      within(review).getByText(
        "The store code needs a different authorised user to approve it before anything is sent."
      )
    ).toBeInTheDocument()
    expect(within(review).getByRole("button", { name: "Publish to Google" })).toBeDisabled()
    expect(
      within(review).getByText("A different authorised user must approve this saved review.")
    ).toBeInTheDocument()
    // Nothing was approved, saved here or sent.
    expect(calls.some(({ method, url }) => url.includes("/business-information") && (method === "POST" || method === "PATCH"))).toBe(false)
    expect(calls.some(({ method, url }) => url.includes("/profile") && (method === "PUT" || method === "POST"))).toBe(false)
  })

  it("stays open on its results when the server holds the profile publish for another publisher", async () => {
    sessionStorage.clear()
    const calls = stubCombined({ secondApprover: false, profileHeld: true })
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const name = await screen.findByRole("textbox", { name: "Business name" })
    await waitFor(() => expect(name).toBeEnabled())
    await userEvent.clear(name)
    await userEvent.type(name, "Camden House")
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog", { name: "Review changes" })
    await userEvent.click(within(review).getByRole("button", { name: "Publish to Google" }))

    const done = await within(review).findByRole("button", { name: "Done" })
    const rows = within(within(review).getByRole("list", { name: "Publish progress" })).getAllByRole("listitem")
    expect(rows).toHaveLength(1)
    // The server's answer, not a client guess: held for approval, not sent.
    expect(rows[0]).toHaveTextContent("Business name")
    expect(rows[0]).toHaveTextContent("Awaiting approval")
    expect(rows[0]).not.toHaveTextContent(/Sent to Google|Live on Google/)
    expect(calls.filter(({ method, url }) => method === "POST" && url.includes("/profile"))).toHaveLength(1)
    expect(
      await within(screen.getByRole("region", { name: "Notifications" })).findByText("Sent for approval")
    ).toBeVisible()
    await userEvent.click(done)
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Review changes" })).toBeNull())
  })
})
