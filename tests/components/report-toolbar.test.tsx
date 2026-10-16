import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
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
import {
  ReportPeriodStrip,
  ReportToolbar,
} from "@/components/reporting/report-toolbar"
import { ToastProvider } from "@/components/ui/toast"

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  replace.mockReset()
  locationPerformance.mockReset()
  search = ""
})

describe("ReportToolbar", () => {
  it("draws the fields inline from md and no second scope control for a phone", () => {
    render(
      <ReportToolbar
        summary={["Old Crown Group", "3 locations", "Last 28 days"]}
        fields={() => <p>the fields</p>}
        meta="3 locations · 4 Aug – 31 Aug"
      />
    )
    const toolbar = screen.getByRole("region", { name: "Report scope" })
    expect(toolbar).toHaveClass("hidden", "md:block")
    expect(screen.getByText("the fields")).toBeInTheDocument()
    expect(screen.getByText("3 locations · 4 Aug – 31 Aug")).toBeInTheDocument()
    // The scope pill and its sheet of selects are gone: the app bar's chip is
    // the scope control, and the period is the strip under the tabs.
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("draws the fields on a phone too when the app bar has no scope chip", () => {
    render(
      <ReportToolbar
        phone
        summary={["Old Crown Group", "Last 28 days"]}
        fields={() => <p>the fields</p>}
        meta="4 Aug – 31 Aug"
        extras={<a href="/x">Open listing</a>}
      />
    )
    const toolbar = screen.getByRole("region", { name: "Report scope" })
    expect(toolbar).toHaveClass("block")
    expect(toolbar).not.toHaveClass("hidden")
    // The caption and the links stay desk-only (the links are in the menu).
    expect(screen.getByText("4 Aug – 31 Aug")).toHaveClass("max-md:hidden")
    expect(
      screen.getByRole("link", { name: "Open listing" }).parentElement
    ).toHaveClass("max-md:hidden")
  })

  it("keeps a printed report saying what it covers", () => {
    render(
      <ReportToolbar
        summary={["Old Crown Group", "3 locations", "Last 28 days"]}
        fields={() => null}
      />
    )
    expect(
      screen.getByText("Old Crown Group · 3 locations · Last 28 days")
    ).toHaveClass("print:block")
  })
})

describe("ReportPeriodStrip", () => {
  const OPTIONS = [
    { id: "28d", label: "Last 28 days" },
    { id: "90d", label: "Last 90 days" },
    { id: "12m", label: "Last 12 months" },
  ]

  it("offers every period as one chip and marks the current one", async () => {
    const onChange = vi.fn()
    render(
      <ReportPeriodStrip value="90d" options={OPTIONS} onChange={onChange} />
    )
    const group = screen.getByRole("group", { name: "Period" })
    expect(within(group).getAllByRole("button")).toHaveLength(3)
    expect(
      within(group).getByRole("button", { name: "Last 90 days" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(group).getByRole("button", { name: "Last 28 days" })
    ).toHaveAttribute("aria-pressed", "false")
    // One tap, nothing to confirm.
    await userEvent.click(
      within(group).getByRole("button", { name: "Last 12 months" })
    )
    expect(onChange).toHaveBeenCalledExactlyOnceWith("12m")
  })

  it("says when the period shown was carried over from another tab", () => {
    render(
      <ReportPeriodStrip
        value="1m"
        options={OPTIONS}
        onChange={() => {}}
        note="Keywords count whole months: showing the last month."
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Keywords count whole months: showing the last month."
    )
  })

  it("draws no note when nothing was carried over", () => {
    render(
      <ReportPeriodStrip value="28d" options={OPTIONS} onChange={() => {}} />
    )
    expect(screen.queryByRole("status")).not.toBeInTheDocument()
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

  it("offers the active tab's period as one-tap chips, not a scope pill", () => {
    stubDirectory()
    search = "tab=keywords"
    renderView()
    const group = screen.getByRole("group", { name: "Period" })
    expect(
      within(group).getByRole("button", { name: "Last 6 months" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(group)
        .getAllByRole("button")
        .map((chip) => chip.textContent)
    ).toEqual([
      "Last month",
      "Last 6 months",
      "Last 12 months",
      "Last 18 months",
    ])
    // The old second scope control (a pill opening a sheet of selects).
    expect(
      screen.queryByRole("button", { name: /^All clients.*Last 6 months$/ })
    ).not.toBeInTheDocument()
  })

  it("changes the period in one tap and writes it to the tab's own parameter", async () => {
    stubDirectory()
    search = "tab=google"
    renderView()
    await userEvent.click(
      within(screen.getByRole("group", { name: "Period" })).getByRole(
        "button",
        { name: "Last 90 days" }
      )
    )
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/reports?tab=google&range=90d",
      { scroll: false }
    )
  })

  it("writes Keywords' period to ?range_kw= and leaves the Google period alone", async () => {
    stubDirectory()
    search = "tab=keywords&range=90d"
    renderView()
    await userEvent.click(
      within(screen.getByRole("group", { name: "Period" })).getByRole(
        "button",
        { name: "Last 12 months" }
      )
    )
    expect(replace).toHaveBeenCalledExactlyOnceWith(
      "/reports?tab=keywords&range=90d&range_kw=12m",
      { scroll: false }
    )
  })

  it("says so when Keywords takes the nearest months to the Google period", () => {
    stubDirectory()
    search = "tab=keywords&range=90d"
    renderView()
    expect(
      within(screen.getByRole("group", { name: "Period" })).getByRole(
        "button",
        { name: "Last 6 months" }
      )
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.getByText(
        "Keywords count whole months: showing the last 6 months."
      )
    ).toBeInTheDocument()
  })

  it("brings each tab's own period back when returning to it", () => {
    stubDirectory()
    search = "tab=google&range=12m&range_kw=1m"
    renderView()
    expect(
      within(screen.getByRole("group", { name: "Period" })).getByRole(
        "button",
        { name: "Last 12 months" }
      )
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      screen.queryByText(/count whole months|counts in days/)
    ).not.toBeInTheDocument()
  })
})

describe("LocationReport period", () => {
  it.each([
    ["locationId=l1&range=90d", "90d"],
    ["locationId=l1", "28d"],
    // The location report shows what the Reply tab would: Keywords' months
    // carry to the nearest days, with the note.
    ["locationId=l1&range=6m", "90d"],
    ["locationId=l1&range_kw=6m", "90d"],
  ])("reads %s as %s", async (query, rangeId) => {
    stubDirectory()
    search = query
    renderView()
    // The figures mount at once; the name and the period summary wait for
    // the directory.
    expect(await screen.findByText("Location figures")).toBeInTheDocument()
    expect(locationPerformance).toHaveBeenLastCalledWith(
      expect.objectContaining({ locationId: "l1", rangeId })
    )
    // The period is the phone's chip strip; the location is named in words.
    expect(
      within(await screen.findByRole("group", { name: "Period" })).getByRole(
        "button",
        { name: `Last ${rangeId.replace("d", "")} days`, pressed: true }
      )
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
