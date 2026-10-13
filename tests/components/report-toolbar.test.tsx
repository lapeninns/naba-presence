import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()
let search = ""
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
  usePathname: () => "/reports",
  useSearchParams: () => new URLSearchParams(search),
}))

const locationPerformance = vi.fn()
vi.mock("@/components/performance/location-performance", () => ({
  LocationPerformance: (props: Record<string, unknown>) => {
    locationPerformance(props)
    return <p>Location figures</p>
  },
}))

import { PerformanceView } from "@/components/performance/performance-view"
import { ReportToolbar } from "@/components/reporting/report-toolbar"
import { ToastProvider } from "@/components/ui/toast"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  replace.mockReset()
  locationPerformance.mockReset()
  search = ""
})

describe("ReportToolbar", () => {
  it("names the scope with the words on screen and opens the fields in a sheet", async () => {
    render(
      <ReportToolbar
        summary={["Old Crown Group", "3 locations", "Last 28 days"]}
        fields={(placement) => <p>{`fields in the ${placement}`}</p>}
        actions={<button type="button">Share report</button>}
      />
    )
    const summary = screen.getByRole("button", {
      name: /^Old Crown Group.*3 locations.*Last 28 days$/,
    })
    // The inline (bar) copy is always present; the sheet copy only when open.
    expect(screen.getByText("fields in the bar")).toBeInTheDocument()
    expect(screen.queryByText("fields in the sheet")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Share report" })).toBeVisible()

    await userEvent.click(summary)
    expect(
      await screen.findByRole("dialog", { name: "Report scope" })
    ).toBeInTheDocument()
    expect(screen.getByText("fields in the sheet")).toBeInTheDocument()

    await userEvent.click(screen.getByRole("button", { name: "Done" }))
    await waitFor(() =>
      expect(screen.queryByText("fields in the sheet")).not.toBeInTheDocument()
    )
  })
})

function stubDirectory() {
  const row = (id: string, name: string) => ({
    locationId: id,
    name,
    address: null,
    timezone: "Europe/London",
    linkId: `link-${id}`,
    externalLocationId: `e-${id}`,
    googleLocationName: `locations/${id}`,
    googleTitle: name,
    verified: true,
    clientId: "c1",
    clientName: "Old Crown Group",
  })
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const body = url.includes("/api/session")
        ? {
            session: {
              userId: "u1",
              organisationId: "o1",
              organisationName: "Agency",
              workspaceMode: "agency",
              displayName: "Owner",
              email: "owner@example.test",
              role: "owner",
              canPublish: true,
            },
          }
        : url.includes("/api/location-links")
          ? { locations: [row("l1", "Girton"), row("l2", "Histon")] }
          : {}
      return new Response(JSON.stringify(body), {
        headers: { "content-type": "application/json" },
      })
    })
  )
}

function renderView() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <PerformanceView />
      </ToastProvider>
    </QueryClientProvider>
  )
}

describe("PerformanceView toolbar", () => {
  it("keeps each tab's visible words at the start of its accessible name", () => {
    stubDirectory()
    renderView()
    for (const name of [
      "Reply performance",
      "Google performance",
      "Keywords",
    ]) {
      const tab = screen.getByRole("tab", { name })
      expect(tab).not.toHaveAttribute("aria-label")
    }
  })

  it("summarises the active tab's period in the scope button", () => {
    stubDirectory()
    search = "tab=keywords"
    renderView()
    expect(
      screen.getByRole("button", { name: /^All clients.*Last 6 months$/ })
    ).toBeInTheDocument()
  })
})

describe("LocationReport period", () => {
  it.each([
    ["locationId=l1&range=90d", "90d"],
    ["locationId=l1", "28d"],
    // Keywords' months are not a location period: the default, not a guess.
    ["locationId=l1&range=6m", "28d"],
  ])("reads %s as %s", async (query, rangeId) => {
    stubDirectory()
    search = query
    renderView()
    expect(await screen.findByText("Location figures")).toBeInTheDocument()
    expect(locationPerformance).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "l1", rangeId })
    )
    expect(
      screen.getByRole("button", { name: /^Girton.*Last \d+ days$/ })
    ).toBeInTheDocument()
  })

  it("names the scoped location in words at every width", async () => {
    stubDirectory()
    search = "locationId=l1"
    renderView()
    const scope = await screen.findByText(/^Reporting on/)
    expect(scope).toHaveTextContent(/^Reporting on Girton/)
    // Not inside the phone-only summary button or the desk-only meta line.
    expect(scope.closest("button")).toBeNull()
    expect(scope.closest(".hidden")).toBeNull()
  })
})
