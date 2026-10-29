import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/performance",
  useSearchParams: () => new URLSearchParams("tab=keywords"),
}))

import { KeywordsTab } from "@/components/performance/keywords-tab"

function stub(body: Record<string, unknown>, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "content-type": "application/json" },
        })
    )
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderTab() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      <KeywordsTab />
    </QueryClientProvider>
  )
}

describe("KeywordsTab", () => {
  it("maps the 503 keywords_paused code to a paused panel, never a raw error", async () => {
    stub({ error: "keywords_paused", message: "paused" }, 503)
    renderTab()
    expect(await screen.findByText(/paused/i)).toBeInTheDocument()
    expect(screen.queryByText(/keywords_paused/)).not.toBeInTheDocument()
  })
  it("renders keyword rows with honest 'N+' for thresholded volumes", async () => {
    stub({
      range: "6m",
      from: "2026-03-01",
      state: "ready",
      locations: [{ id: "l", name: "L" }],
      keywords: [
        {
          rank: 1,
          keyword: "riverside hotel bath",
          impressions: 5200,
          upperBound: 5200,
          thresholded: false,
          firstMonth: "2026-03",
          latestMonth: "2026-08",
        },
        {
          rank: 2,
          keyword: "spa near me",
          impressions: 1000,
          upperBound: 9999,
          thresholded: true,
          firstMonth: "2026-05",
          latestMonth: "2026-08",
        },
      ],
      unavailableReasons: [],
    })
    renderTab()
    expect(await screen.findByText("riverside hotel bath")).toBeInTheDocument()
    expect(screen.getByText("5,200")).toBeInTheDocument()
    expect(screen.getByText("1,000+")).toBeInTheDocument()
  })
  it("puts how Google counts these under the terms, not in a box above them", async () => {
    stub({
      range: "6m",
      from: "2026-03-01",
      state: "ready",
      locations: [{ id: "l", name: "L" }],
      keywords: [
        {
          rank: 1,
          keyword: "riverside hotel bath",
          impressions: 5200,
          upperBound: 5200,
          thresholded: false,
          firstMonth: "2026-03",
          latestMonth: "2026-08",
        },
      ],
      unavailableReasons: [],
    })
    renderTab()
    const term = await screen.findByText("riverside hotel bath")
    const note = screen.getByText(/How Google counts these/)
    // A footnote: after the first term in the document, and plain text, not an alert.
    expect(
      term.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(note.closest("[data-slot=alert]")).toBeNull()
  })
  it("shows an empty panel when there are no keywords", async () => {
    stub({
      range: "6m",
      from: "2026-03-01",
      state: "empty",
      locations: [{ id: "l", name: "L" }],
      keywords: [],
      unavailableReasons: [],
    })
    renderTab()
    // The panel's own title, not a loose regex: this assertion used to be
    // satisfied by the header caption's "No data yet — nothing to show",
    // which rendered while the query was still in flight. It passed without
    // the empty panel ever being on screen.
    expect(await screen.findByText("No keywords yet")).toBeInTheDocument()
  })
})

describe("KeywordsTab in plain words", () => {
  const ready = {
    range: "6m",
    from: "2026-03-01",
    state: "ready",
    locations: [{ id: "l", name: "L" }],
    keywords: [
      {
        rank: 1,
        keyword: "riverside hotel bath",
        impressions: 5200,
        upperBound: 5200,
        thresholded: false,
        firstMonth: "2026-03",
        latestMonth: "2026-08",
      },
    ],
    unavailableReasons: [],
  }

  it("names the month the count starts and calls impressions times shown", async () => {
    stub(ready)
    renderTab()
    expect(
      await screen.findByText("Times shown in search, counted from March 2026")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("columnheader", { name: "Times shown" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText(/Impressions counted from/)
    ).not.toBeInTheDocument()
  })

  it("has no counted-from caption over a panel it does not describe", async () => {
    stub({ ...ready, state: "no_link", keywords: [] })
    renderTab()
    expect(await screen.findByText("No linked listing")).toBeInTheDocument()
    expect(screen.queryByText(/counted from/)).not.toBeInTheDocument()
  })

  it('does not say "some" when nothing could be refreshed', async () => {
    stub({
      ...ready,
      state: "unavailable",
      keywords: [],
      unavailableReasons: ["keyword_sync_failed"],
    })
    renderTab()
    expect(
      await screen.findByText("Search keywords could not be refreshed")
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Some keywords could not be refreshed")
    ).not.toBeInTheDocument()
  })

  it.each([
    ["6m", true],
    ["1m", true],
    ["12m", false],
  ] as const)(
    "offers the last 12 months on a quiet %s period: %s",
    async (range, offered) => {
      stub({ ...ready, range, state: "empty", keywords: [] })
      const onRangeChange = vi.fn()
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      })
      render(
        <QueryClientProvider client={client}>
          <KeywordsTab range={range} onRangeChange={onRangeChange} />
        </QueryClientProvider>
      )
      expect(
        await screen.findByText(
          "Google has not reported any search keywords for this period."
        )
      ).toBeInTheDocument()
      const button = screen.queryByRole("button", {
        name: "Show the last 12 months",
      })
      if (!offered) {
        expect(button).not.toBeInTheDocument()
        return
      }
      await userEvent.click(button!)
      expect(onRangeChange).toHaveBeenCalledExactlyOnceWith("12m")
    }
  )
})
