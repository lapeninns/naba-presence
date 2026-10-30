import { screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { renderWithProviders } from "../helpers/render"
import { GoogleChangesBadge } from "@/components/listings/google-changes-badge"
import { ApiClientError } from "@/lib/api/client"
import * as watchApi from "@/lib/api/google-change-watch"
import type {
  GoogleChange,
  GoogleChangesResponse,
} from "@/lib/contracts/google-change-watch"

const LOCATION = "33333333-3333-4333-8333-333333333333"

function change(id: string, status: GoogleChange["status"]): GoogleChange {
  return {
    id,
    field: "name",
    status,
    resolution: null,
    ours: { field: "name", value: "The White Horse" },
    google: { field: "name", value: "White Horse Pub" },
    googleHash: "a".repeat(64),
    localEdits: false,
    regularDays: [],
    specialDates: [],
    detectedAt: "2026-10-28T09:00:00.000Z",
    lastSeenAt: "2026-10-29T09:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    revert: null,
  }
}

function response(changes: GoogleChange[]): GoogleChangesResponse {
  return { changes, canDecide: true, lastCheckedAt: "2026-10-29T09:00:00.000Z" }
}

function renderBadge() {
  return renderWithProviders(<GoogleChangesBadge locationId={LOCATION} />)
}

describe("GoogleChangesBadge", () => {
  afterEach(() => vi.restoreAllMocks())

  it("renders nothing while loading", () => {
    vi.spyOn(watchApi, "fetchGoogleChanges").mockReturnValue(
      new Promise(() => {})
    )
    renderBadge()

    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText(/changed on Google/)).toBeNull()
  })

  it("renders nothing when the load fails", async () => {
    const fetch = vi
      .spyOn(watchApi, "fetchGoogleChanges")
      .mockRejectedValue(new ApiClientError(500, "internal", "boom"))
    renderBadge()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText(/changed on Google/)).toBeNull()
  })

  it("renders nothing when only reverting or settled changes remain", async () => {
    const fetch = vi
      .spyOn(watchApi, "fetchGoogleChanges")
      .mockResolvedValue(
        response([
          change("1", "reverting"),
          change("2", "accepted"),
          change("3", "resolved"),
        ])
      )
    renderBadge()

    await waitFor(() => expect(fetch).toHaveBeenCalled())
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(screen.queryByRole("link")).toBeNull()
    expect(screen.queryByText(/changed on Google/)).toBeNull()
  })

  it("links to the suggestions tab with the count of open changes", async () => {
    vi.spyOn(watchApi, "fetchGoogleChanges").mockResolvedValue(
      response([
        change("1", "open"),
        change("2", "open"),
        change("3", "reverting"),
        change("4", "superseded"),
      ])
    )
    renderBadge()

    const link = await screen.findByRole("link")
    expect(link).toHaveAttribute("href", `/listings/${LOCATION}/suggestions`)
    expect(link).toHaveTextContent("2 changed on Google")
  })
})
