import {
  act,
  cleanup,
  createEvent,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  ServicesSection,
  type ServiceActions,
  type ServiceEditorStatus,
} from "@/components/locations/profile/sections/services-section"
import type { BusinessInformationState } from "@/lib/contracts/location-business-information"

import {
  errorResponse,
  jsonResponse,
  stubNetwork,
} from "./onboarding-draft-fixtures"
import { pick } from "./onboarding-form-helpers"

const LOCATION_HASH = "a".repeat(64)
const REVIEWED = "00000000-0000-4000-8000-000000000021"

const metadata = {
  serviceMetadata: {
    categories: [
      {
        name: "categories/gcid:pub",
        displayName: "Pub",
        serviceTypes: [
          {
            serviceTypeId: "job_type_id:sunday_roast",
            displayName: "Sunday roast",
          },
          { serviceTypeId: "job_type_id:catering", displayName: "Catering" },
        ],
      },
    ],
    regionCode: "GB",
    languageCode: "en-GB",
    observedAt: "2026-10-14T10:00:00.000Z",
    locationHash: LOCATION_HASH,
  },
}

type Item = Record<string, unknown>
const business = (
  serviceItems: Item[] | undefined,
  overrides: Partial<BusinessInformationState> = {}
) =>
  ({
    location: { title: "The Old Crown", serviceItems },
    locationHash: LOCATION_HASH,
    canPublish: true,
    writesEnabled: true,
    ...overrides,
  }) as unknown as BusinessInformationState

const roast = {
  structuredServiceItem: {
    serviceTypeId: "job_type_id:sunday_roast",
    description: "Served 12 to 6",
  },
  price: { currencyCode: "GBP", units: "15", nanos: 0 },
}

const changeSet = (body: { payload: Record<string, unknown> }) => ({
  changeSet: {
    id: REVIEWED,
    locationName: "The Old Crown",
    payloadHash: "e".repeat(64),
    baselineHash: LOCATION_HASH,
    payload: body.payload,
    baseline: { serviceItems: [roast] },
    updateMask: ["serviceItems"],
    requestedBy: "owner",
    approvedBy: null,
    requiresSecondApprover: false,
    canApprove: true,
    expiresAt: "2027-01-01T00:00:00Z",
  },
})

function routes(
  extra?: (url: URL, init?: RequestInit) => Response | undefined
) {
  return stubNetwork((url, init) => {
    const custom = extra?.(url, init)
    if (custom) return custom
    const type = url.searchParams.get("type")
    if (init?.method === "PUT")
      return jsonResponse(changeSet(JSON.parse(String(init.body))))
    if (type === "services") return jsonResponse(metadata)
    if (type === "reviews") return jsonResponse({ changeSets: [] })
    return jsonResponse({})
  })
}

beforeEach(() => {
  sessionStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function setup(
  state: BusinessInformationState = business([roast]),
  readOnly = false
) {
  const actions = createRef<ServiceActions>()
  const statuses: ServiceEditorStatus[] = []
  const user = userEvent.setup()
  renderWithProviders(
    <ServicesSection
      locationId="loc-1"
      business={state}
      actions={actions}
      onStatus={(status) => statuses.push(status)}
      readOnly={readOnly}
    />
  )
  return { user, actions, statuses }
}

const reviewButton = () =>
  screen.getByRole("button", { name: "Review service changes" })
const ready = () =>
  waitFor(() =>
    expect(
      screen.queryByText("Loading available services…")
    ).not.toBeInTheDocument()
  )

describe("ServicesSection", () => {
  it("hands over to Google when the saved services are in a shape it cannot preserve", () => {
    routes()
    setup(business([{ foo: 1 }]))
    expect(
      screen.getByText(
        /Google returned service details this editor cannot preserve/
      )
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Review service changes" })
    ).not.toBeInTheDocument()
  })

  it("shows the saved services with their description and price, and nothing to review yet", async () => {
    routes()
    const { statuses } = setup()
    await ready()
    expect(
      screen.getByRole("heading", { name: "Sunday roast" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Description")).toHaveValue("Served 12 to 6")
    expect(screen.getByLabelText("Price")).toHaveValue("15")
    expect(screen.getByLabelText("Currency")).toHaveValue("GBP")
    expect(reviewButton()).toBeDisabled()
    expect(statuses.at(-1)).toEqual({ dirty: false, blocked: null })
  })

  it("says so when there are no services", async () => {
    routes()
    setup(business(undefined))
    expect(screen.getByText("No services added.")).toBeInTheDocument()
    await ready()
  })

  it("loads the choices, and offers a retry when that fails", async () => {
    let attempts = 0
    const { calls } = routes((url) =>
      url.searchParams.get("type") === "services" && ++attempts === 1
        ? errorResponse(503, "google_unavailable", "Google is not answering.")
        : undefined
    )
    const { user } = setup()
    expect(
      await screen.findByText("Google is not answering.")
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Retry service choices" })
    )
    await waitFor(() =>
      expect(
        screen.queryByText("Google is not answering.")
      ).not.toBeInTheDocument()
    )
    expect(calls.filter((call) => call.query.type === "services")).toHaveLength(
      2
    )
  })

  it("adds a suggested service and marks the section changed and blocked-free", async () => {
    routes()
    const { user, statuses } = setup(business([]))
    await ready()
    await pick(user, "Add a suggested service", "Catering")
    expect(
      screen.getByRole("heading", { name: "Catering" })
    ).toBeInTheDocument()
    expect(reviewButton()).toBeEnabled()
    expect(statuses.at(-1)).toEqual({ dirty: true, blocked: null })
  })

  it("adds a custom service for a category, which needs a name before it can be reviewed", async () => {
    routes()
    const { user, statuses } = setup(business([]))
    await ready()
    await user.click(
      await screen.findByRole("button", { name: "Add custom service for Pub" })
    )
    expect(reviewButton()).toBeDisabled()
    expect(statuses.at(-1)?.blocked).toBeTruthy()
    await user.type(screen.getByLabelText("Service name"), "Private hire")
    expect(reviewButton()).toBeEnabled()
    expect(statuses.at(-1)).toEqual({ dirty: true, blocked: null })
  })

  it("refuses a price that is not a number, naming the service", async () => {
    routes()
    const { user } = setup()
    await ready()
    const price = screen.getByLabelText("Price")
    await user.clear(price)
    await user.type(price, "twelve")
    expect(
      screen.getByText(
        "Service 1: Enter a price with up to nine decimal places."
      )
    ).toBeInTheDocument()
    expect(reviewButton()).toBeDisabled()
  })

  it("refuses a currency that is not three letters", async () => {
    routes()
    const { user } = setup()
    await ready()
    const currency = screen.getByLabelText("Currency")
    await user.clear(currency)
    await user.type(currency, "PO")
    expect(
      screen.getByText(
        "Service 1: Enter a three-letter currency and a valid price."
      )
    ).toBeInTheDocument()
  })

  it("sends the changed price as units and nanos under the location's hash", async () => {
    const { calls } = routes()
    const { user } = setup()
    await ready()
    const price = screen.getByLabelText("Price")
    await user.clear(price)
    await user.type(price, "16.5")
    await user.click(reviewButton())
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PUT")).toBe(true)
    )
    expect(calls.find((call) => call.method === "PUT")).toMatchObject({
      path: "/api/locations/loc-1/business-information",
      body: {
        updateMask: ["serviceItems"],
        expectedGoogleHash: LOCATION_HASH,
        payload: {
          serviceItems: [
            {
              structuredServiceItem: {
                serviceTypeId: "job_type_id:sunday_roast",
                description: "Served 12 to 6",
              },
              price: { currencyCode: "GBP", units: "16", nanos: 500000000 },
            },
          ],
        },
      },
    })
  })

  it("clears the price and the description from what is sent", async () => {
    const { calls } = routes()
    const { user } = setup()
    await ready()
    await user.click(screen.getByRole("button", { name: "Clear price" }))
    await user.click(screen.getByRole("button", { name: "Clear description" }))
    expect(screen.getByLabelText("Price")).toHaveValue("")
    expect(screen.getByLabelText("Description")).toHaveValue("")
    await user.click(reviewButton())
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PUT")).toBe(true)
    )
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      payload: {
        serviceItems: [
          {
            structuredServiceItem: {
              serviceTypeId: "job_type_id:sunday_roast",
            },
          },
        ],
      },
    })
    const sent = (
      calls.find((call) => call.method === "PUT")?.body as {
        payload: { serviceItems: Item[] }
      }
    ).payload.serviceItems[0]
    expect(sent).not.toHaveProperty("price")
    expect(sent.structuredServiceItem).not.toHaveProperty("description")
  })

  it("removes a service, and removing the last one sends an empty list", async () => {
    const { calls } = routes()
    const { user } = setup()
    await ready()
    await user.click(screen.getByRole("button", { name: "Remove service 1" }))
    expect(screen.getByText("No services added.")).toBeInTheDocument()
    await user.click(reviewButton())
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PUT")).toBe(true)
    )
    expect(calls.find((call) => call.method === "PUT")?.body).toMatchObject({
      payload: { serviceItems: [] },
    })
  })

  it("shows the refusal, and keeps the edit, when Google's baseline has moved", async () => {
    routes((_url, init) =>
      init?.method === "PUT"
        ? errorResponse(
            409,
            "google_baseline_stale",
            "Google changed since you loaded this."
          )
        : undefined
    )
    const { user } = setup()
    await ready()
    await user.click(screen.getByRole("button", { name: "Remove service 1" }))
    await user.click(reviewButton())
    expect(
      await screen.findByText("Google changed since you loaded this.")
    ).toBeInTheDocument()
  })

  it("opens the review sheet with the before and after of what changed", async () => {
    routes()
    const { user } = setup()
    await ready()
    const price = screen.getByLabelText("Price")
    await user.clear(price)
    await user.type(price, "16")
    await user.click(reviewButton())
    const sheet = await screen.findByRole("dialog")
    expect(sheet).toHaveTextContent("Service 1")
    expect(sheet).toHaveTextContent("GBP 16")
    expect(sheet).toHaveTextContent("GBP 15")
  })

  it("lets the page's action bar review and discard through the handle it was given", async () => {
    const { calls } = routes()
    const { user, actions, statuses } = setup()
    await ready()
    await user.click(screen.getByRole("button", { name: "Remove service 1" }))
    expect(statuses.at(-1)?.dirty).toBe(true)
    await act(async () => actions.current?.discard())
    expect(
      screen.getByRole("heading", { name: "Sunday roast" })
    ).toBeInTheDocument()
    expect(statuses.at(-1)).toEqual({ dirty: false, blocked: null })
    await user.click(screen.getByRole("button", { name: "Remove service 1" }))
    await act(async () => actions.current?.review())
    await waitFor(() =>
      expect(calls.some((call) => call.method === "PUT")).toBe(true)
    )
  })

  it("is read-only, with sending unavailable, when the person cannot publish", async () => {
    routes()
    const { statuses } = setup(business([roast], { canPublish: false }))
    await ready()
    expect(screen.getByLabelText("Price")).toBeDisabled()
    expect(
      screen.getByRole("button", { name: "Remove service 1" })
    ).toBeDisabled()
    expect(reviewButton()).toBeDisabled()
    expect(statuses.at(-1)).toEqual({
      dirty: false,
      blocked: "Service publishing is unavailable.",
    })
  })

  it("is read-only when the page says so", async () => {
    routes()
    setup(business([roast]), true)
    await ready()
    expect(screen.getByLabelText("Description")).toBeDisabled()
  })
})
