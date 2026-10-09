import { useQueryClient } from "@tanstack/react-query"
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

function stubRoutes(overrides?: { caps?: unknown; business?: unknown; saveFailure?: boolean }) {
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
    if (url.includes("/profile") && args[1]?.method === "PUT" && overrides?.saveFailure) return jsonResponse({ error: "http_error" }, 503)
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
      screen.getAllByText("Published after review").length
    ).toBeGreaterThan(0)

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

describe("ProfileTab save and review boundaries", () => {
  it("explains Save here scope and requires review for provider-only edits", async () => {
    sessionStorage.clear()
    const fetcher = stubRoutes()
    renderWithProviders(<ProfileTab locationId="loc-1" />)
    const storeCode = await screen.findByDisplayValue("CAMDEN-1")
    await waitFor(() => expect(storeCode).toBeEnabled())
    await userEvent.clear(storeCode)
    await userEvent.type(storeCode, "CAMDEN-2")
    const save = screen.getByRole("button", { name: "Save here" })
    expect(save).toBeDisabled()
    expect(save).toHaveAccessibleDescription(/name, description, phone and website/i)
    expect(screen.getAllByText("Published after review").length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog")
    expect(within(review).getByText("CAMDEN-2")).toBeInTheDocument()
    await userEvent.click(within(review).getByRole("button", { name: "Keep editing" }))
    expect(screen.getByDisplayValue("CAMDEN-2")).toBeInTheDocument()
    expect(fetcher.mock.calls.every(([, init]) => !init?.method || init.method === "GET")).toBe(true)
    const beforeUnload = new Event("beforeunload", { cancelable: true })
    window.dispatchEvent(beforeUnload)
    expect(beforeUnload.defaultPrevented).toBe(true)
  })

  it("reports the exact successful and failed steps after partial publication", async () => {
    sessionStorage.clear()
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input)
      if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
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
    await userEvent.click(screen.getByRole("switch", { name: /Wi-Fi/ }))
    await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
    const review = await screen.findByRole("dialog")
    await userEvent.click(within(review).getByRole("button", { name: "Publish to Google" }))
    expect(await within(review).findByRole("button", { name: "Try again" })).toBeInTheDocument()
    const progress = within(review).getByRole("list", { name: "Publish progress" })
    expect(progress).toHaveTextContent("Publish categories, address and status")
    expect(progress).toHaveTextContent("Sent to Google")
    expect(progress).toHaveTextContent("Publish attributes")
    expect(progress).toHaveTextContent("Failed")
    expect(review).toHaveTextContent("Earlier steps were sent to Google.")
    expect(review).not.toHaveTextContent("Nothing was changed")
    expect(await within(screen.getByRole("region", { name: "Notifications" })).findByText(/Earlier steps were sent to Google/)).toBeVisible()
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
  await waitFor(() => expect(screen.getByRole("button", { name: "Save here" })).toBeDisabled())
  const beforeUnload = new Event("beforeunload", { cancelable: true })
  window.dispatchEvent(beforeUnload)
  expect(beforeUnload.defaultPrevented).toBe(true)
  await userEvent.click(screen.getByRole("button", { name: "Discard" }))
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
    await userEvent.click(within(review).getByRole("button", { name: "Publish to Google" }))
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
  vi.stubGlobal("fetch", vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input)
    if (url.includes("/capabilities")) return jsonResponse({ capabilities: { canEditCanonical: true, canPublish: true } })
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
  await userEvent.click(screen.getByRole("switch", { name: /Wi-Fi/ }))
  await userEvent.click(screen.getByRole("button", { name: "Review changes" }))
  const review = await screen.findByRole("dialog")
  await userEvent.click(within(review).getByRole("button", { name: "Publish to Google" }))
  await within(review).findByRole("button", { name: "Try again" })
  await userEvent.click(within(review).getByRole("button", { name: "Keep editing" }))
  external = true
  await userEvent.click(screen.getByRole("button", { name: "Refresh fixture" }))
  await screen.findByRole("button", { name: "Load theirs" })
  expect(screen.getByRole("switch", { name: /Wi-Fi/ })).toBeChecked()
  expect(store).toHaveValue("CAMDEN-2")
  if (listingSent) {
    await userEvent.click(screen.getByRole("button", { name: "Discard" }))
    await userEvent.click(await screen.findByRole("button", { name: "Discard changes" }))
    expect(store).toHaveValue("CAMDEN-2")
    expect(screen.getByRole("switch", { name: /Wi-Fi/ })).not.toBeChecked()
  }
})
