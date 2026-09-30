import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { ProfileTab } from "@/components/locations/profile/profile-editor"
import { locationFieldCapabilities } from "@/lib/domain/google-capabilities"
import { businessInformationPreviewSchema } from "@/lib/contracts/location-business-information"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"
import { emptyListingSummary } from "@/lib/contracts/location-summary"

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
    await userEvent.click(
      within(lodging).getByRole("combobox", { name: "Pets allowed" })
    )
    await userEvent.click(await screen.findByRole("option", { name: "Yes" }))
    const footer = screen.getByRole("region", { name: "Editor actions" })
    expect(
      await within(footer).findByText("1 change not on Google")
    ).toBeInTheDocument()
    expect(
      within(footer).getByRole("button", { name: "Save here" })
    ).toBeDisabled()
    expect(
      within(footer).getByRole("button", { name: "Review lodging draft" })
    ).toBeEnabled()
    await userEvent.click(
      within(footer).getByRole("button", { name: "Discard" })
    )
    await userEvent.click(
      await screen.findByRole("button", { name: "Discard changes" })
    )
    await waitFor(() =>
      expect(
        within(lodging).getByRole("combobox", { name: "Pets allowed" })
      ).toHaveTextContent("No")
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

    // Each section says where its edits go.
    expect(screen.getAllByText("Saved here first").length).toBeGreaterThan(0)
    expect(
      screen.getAllByText("No draft · reviewed, then sent to Google").length
    ).toBeGreaterThan(0)
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
