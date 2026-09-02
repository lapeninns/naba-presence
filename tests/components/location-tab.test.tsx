import { useQuery } from "@tanstack/react-query"
import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import {
  LocationTab,
  type LocationTabRenderProps,
} from "@/components/locations/location-tab"
import { ApiClientError } from "@/lib/api/client"

type Thing = { name: string; writesEnabled: boolean }

// The resource under test: a real useQuery hook (so pending/error/refetch are
// the real TanStack states) over a per-test controllable fetcher.
const fetchThing = vi.fn<(locationId: string) => Promise<Thing>>()
function useThing(locationId: string) {
  return useQuery({
    queryKey: ["test-thing", locationId],
    queryFn: () => fetchThing(locationId),
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

// Capabilities go through the REAL useLocationCapabilities + apiFetch, so the
// stub answers the capabilities URL; `caps` may be a function to vary answers.
function stubCaps(caps: unknown | (() => unknown), status = 200) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => {
    const url = String(input)
    if (url.includes("/capabilities")) {
      const body = typeof caps === "function" ? caps() : caps
      return status === 200
        ? jsonResponse({ capabilities: body })
        : jsonResponse({ error: "server_error" }, status)
    }
    throw new Error(`unexpected fetch ${url}`)
  })
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function Loaded({
  data,
  caps,
  disabled,
  editReason,
  publishReason,
}: LocationTabRenderProps<Thing>) {
  return (
    <div>
      <p>Loaded: {data.name}</p>
      <p>caps: {caps ? "known" : "unknown"}</p>
      <p>disabled: {String(disabled)}</p>
      <p>edit: {editReason ?? "none"}</p>
      <p>publish: {publishReason ?? "none"}</p>
    </div>
  )
}

const OWNER = { canEditCanonical: true, canPublish: true }
const MEMBER = { canEditCanonical: false, canPublish: false }

// Braces matter: a hook that RETURNS the mock would have it called as a cleanup.
beforeEach(() => {
  fetchThing.mockReset()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("LocationTab", () => {
  it("shows the loading skeleton while the resource is pending", () => {
    stubCaps(OWNER)
    fetchThing.mockReturnValue(new Promise(() => {}))
    const { container } = renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing}>
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
    expect(screen.queryByText(/^Loaded:/)).not.toBeInTheDocument()
  })

  it("renders the humanised error with a retry that refetches the resource", async () => {
    stubCaps(OWNER)
    fetchThing
      .mockRejectedValueOnce(new ApiClientError(500, "http_error", "boom"))
      .mockResolvedValueOnce({ name: "widget", writesEnabled: true })
    renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing}>
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(
      await screen.findByText(/couldn.t load this section/i)
    ).toBeInTheDocument()
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(await screen.findByText("Loaded: widget")).toBeInTheDocument()
    expect(fetchThing).toHaveBeenCalledTimes(2)
  })

  it("renders the not-linked state without a retry", async () => {
    stubCaps(OWNER)
    fetchThing.mockRejectedValue(
      new ApiClientError(409, "google_location_not_linked", "not linked")
    )
    renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing}>
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(
      await screen.findByText(/isn.t linked to Google yet/i)
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()
  })

  it("renders the loaded state with gate reasons derived from capabilities", async () => {
    stubCaps(MEMBER)
    fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
    renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing} resource="things">
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(await screen.findByText("Loaded: widget")).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByText("caps: known")).toBeInTheDocument()
    )
    expect(screen.getByText("disabled: true")).toBeInTheDocument()
    expect(
      screen.getByText("edit: Only owners and admins can edit this location.")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "publish: You do not have permission to publish this location to Google."
      )
    ).toBeInTheDocument()
  })

  it("does not wait for capabilities when no gate is required", async () => {
    // Capabilities never answer; an ungated tab still renders and reports no reasons.
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(() => new Promise(() => {}))
    )
    fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
    renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing}>
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(await screen.findByText("Loaded: widget")).toBeInTheDocument()
    expect(screen.getByText("caps: unknown")).toBeInTheDocument()
    expect(screen.getByText("disabled: false")).toBeInTheDocument()
    expect(screen.getByText("edit: none")).toBeInTheDocument()
    expect(screen.getByText("publish: none")).toBeInTheDocument()
  })

  it("prefers the per-resource capability state and the data's writesEnabled flag", async () => {
    stubCaps({ ...OWNER, resources: { things: { state: "readOnly" } } })
    fetchThing.mockResolvedValue({ name: "widget", writesEnabled: false })
    renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing} resource="things">
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(
      await screen.findByText("publish: This section is read-only right now.")
    ).toBeInTheDocument()
    expect(screen.getByText("disabled: false")).toBeInTheDocument()
  })

  it("falls back to writesEnabled from the data, or the writesEnabled prop when given", async () => {
    stubCaps(OWNER)
    fetchThing.mockResolvedValue({ name: "widget", writesEnabled: false })
    const view = renderWithProviders(
      <LocationTab locationId="loc-1" useResource={useThing} resource="things">
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(
      await screen.findByText(
        "publish: Publishing to Google is currently unavailable."
      )
    ).toBeInTheDocument()

    view.unmount()
    renderWithProviders(
      <LocationTab
        locationId="loc-1"
        useResource={useThing}
        resource="things"
        writesEnabled={() => true}
      >
        {(props) => <Loaded {...props} />}
      </LocationTab>
    )
    expect(await screen.findByText("publish: none")).toBeInTheDocument()
  })

  describe("requires gate", () => {
    it("shows the gated notice for a member and never fires the resource query", async () => {
      stubCaps(MEMBER)
      fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
      renderWithProviders(
        <LocationTab
          locationId="loc-1"
          useResource={useThing}
          requires="canEditCanonical"
        >
          {(props) => <Loaded {...props} />}
        </LocationTab>
      )
      expect(
        await screen.findByText(
          "This section is available to owners and admins"
        )
      ).toBeInTheDocument()
      expect(fetchThing).not.toHaveBeenCalled()
    })

    it("holds the resource query while capabilities are still pending", () => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(() => new Promise(() => {}))
      )
      fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
      const { container } = renderWithProviders(
        <LocationTab
          locationId="loc-1"
          useResource={useThing}
          requires="canEditCanonical"
        >
          {(props) => <Loaded {...props} />}
        </LocationTab>
      )
      expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument()
      expect(fetchThing).not.toHaveBeenCalled()
    })

    it("lets an owner through and supports a custom gated title", async () => {
      stubCaps(OWNER)
      fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
      renderWithProviders(
        <LocationTab
          locationId="loc-1"
          useResource={useThing}
          requires="canEditCanonical"
          gatedTitle="Owners only"
        >
          {(props) => <Loaded {...props} />}
        </LocationTab>
      )
      expect(await screen.findByText("Loaded: widget")).toBeInTheDocument()
      expect(screen.queryByText("Owners only")).not.toBeInTheDocument()
    })

    it("offers a retry when the capabilities query itself fails", async () => {
      let attempts = 0
      const fetchMock = vi.fn<typeof fetch>(async (input) => {
        if (!String(input).includes("/capabilities"))
          throw new Error("unexpected fetch")
        attempts += 1
        return attempts === 1
          ? jsonResponse({ error: "server_error" }, 500)
          : jsonResponse({ capabilities: OWNER })
      })
      vi.stubGlobal("fetch", fetchMock)
      fetchThing.mockResolvedValue({ name: "widget", writesEnabled: true })
      renderWithProviders(
        <LocationTab
          locationId="loc-1"
          useResource={useThing}
          requires="canEditCanonical"
        >
          {(props) => <Loaded {...props} />}
        </LocationTab>
      )
      await userEvent.click(
        await screen.findByRole("button", { name: "Try again" })
      )
      expect(await screen.findByText("Loaded: widget")).toBeInTheDocument()
    })
  })
})
