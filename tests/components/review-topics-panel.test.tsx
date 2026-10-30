import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewTopicsPanel } from "@/components/reports/review-topics-panel"
import type { ReviewTopicReport } from "@/lib/domain/review-topics-report"
import {
  computeTopicTrends,
  trendWeeks,
  type ClassifiedCountRow,
  type TopicCountRow,
} from "@/lib/domain/review-topics-trends"
import { renderWithProviders } from "@/tests/helpers/render"

// "What guests talk about" (S3): the panel reads GET
// /api/analytics/review-topics through the real query hook and the shared
// schema, so the fetch stub returns the wire shape the route sends, built
// with the same pure arithmetic the route uses.

const NOW = new Date("2026-10-28T12:00:00Z")
const WEEKS = trendWeeks(NOW)

/** The inbox on what a figure counts: every queue, the topic, the window. */
function inbox(
  topic: string,
  scope: { locationId?: string; clientId?: string } = {}
) {
  const query = new URLSearchParams({ queue: "all", topic })
  if (scope.clientId) query.set("clientId", scope.clientId)
  if (scope.locationId) query.set("locationId", scope.locationId)
  query.set("dateFrom", `${WEEKS[0]}T00:00:00.000Z`)
  return `/inbox?${query}`
}

const ZED = {
  id: "6f1d2c3b-4a5e-4f60-8b71-92a3b4c5d6e7",
  name: "Zed Tavern",
}
const ALPHA = {
  id: "0a9b8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d",
  name: "Alpha Inn",
}

function report(input: {
  locations: { id: string; name: string }[]
  topicRows?: TopicCountRow[]
  classifiedRows?: ClassifiedCountRow[]
  pendingReviews?: number
}): ReviewTopicReport {
  return {
    ...computeTopicTrends({
      now: NOW,
      locations: input.locations,
      topicRows: input.topicRows ?? [],
      classifiedRows: input.classifiedRows ?? [],
    }),
    pendingReviews: input.pendingReviews ?? 0,
  }
}

/**
 * Two listings, six classified reviews. Group figures:
 * - Food quality 3 mentions (Zed 2 positive this week, Alpha 1 negative last
 *   week): 50% of reviews, 33% negative.
 * - Service 2 (Zed only, negative, this week): 33%, 100% negative.
 * - Drinks 1 (Alpha only, neutral, three weeks ago): 17%, 0% negative.
 * Mention order (food, service, drinks) differs from REVIEW_TOPICS order
 * (food, drinks, service), so the table's sort is what is tested.
 * Alphabetically Alpha comes first; by food-quality mentions Zed does.
 */
function twoListingReport(pendingReviews = 0) {
  return report({
    locations: [ZED, ALPHA],
    pendingReviews,
    classifiedRows: [
      { locationId: ZED.id, week: WEEKS[7], reviews: 4 },
      { locationId: ALPHA.id, week: WEEKS[6], reviews: 2 },
    ],
    topicRows: [
      {
        locationId: ZED.id,
        week: WEEKS[7],
        topic: "food_quality",
        sentiment: "positive",
        count: 2,
      },
      {
        locationId: ALPHA.id,
        week: WEEKS[6],
        topic: "food_quality",
        sentiment: "negative",
        count: 1,
      },
      {
        locationId: ZED.id,
        week: WEEKS[7],
        topic: "service",
        sentiment: "negative",
        count: 2,
      },
      {
        locationId: ALPHA.id,
        week: WEEKS[5],
        topic: "drinks",
        sentiment: "neutral",
        count: 1,
      },
    ],
  })
}

/** The same figures scoped to Zed alone, as the route sends for one listing. */
function zedOnlyReport() {
  return report({
    locations: [ZED],
    classifiedRows: [{ locationId: ZED.id, week: WEEKS[7], reviews: 4 }],
    topicRows: [
      {
        locationId: ZED.id,
        week: WEEKS[7],
        topic: "food_quality",
        sentiment: "positive",
        count: 2,
      },
      {
        locationId: ZED.id,
        week: WEEKS[7],
        topic: "service",
        sentiment: "negative",
        count: 1,
      },
    ],
  })
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })

function stubFetch(...responses: (() => Response | Promise<Response>)[]) {
  let call = 0
  const fetchMock = vi.fn<(input: RequestInfo | URL) => Promise<Response>>(
    async () => {
      const next = responses[Math.min(call, responses.length - 1)]
      call += 1
      return next()
    }
  )
  vi.stubGlobal("fetch", fetchMock)
  return fetchMock
}

function requestedUrl(fetchMock: ReturnType<typeof stubFetch>, index = 0) {
  const input = fetchMock.mock.calls[index][0]
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url
  return new URL(raw, "http://localhost")
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** The "What guests talk about" section. */
function panel() {
  return screen.getByRole("region", { name: "What guests talk about" })
}

/** The first table in the panel: one row per mentioned topic. */
async function topicTable() {
  await screen.findByText(/^From \d+ reviews? with text\./)
  return within(panel()).getAllByRole("table")[0]
}

function bodyRows(table: HTMLElement) {
  // Skip the header row.
  return within(table).getAllByRole("row").slice(1)
}

describe("ReviewTopicsPanel heading and request", () => {
  it("is a section headed (h2) 'What guests talk about'", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    expect(
      screen.getByRole("heading", { level: 2, name: "What guests talk about" })
    ).toBeInTheDocument()
    expect(panel()).toBeInTheDocument()
    await topicTable()
  })

  it("asks for the whole scope with no query when given no ids", async () => {
    const fetchMock = stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    const url = requestedUrl(fetchMock)
    expect(url.pathname).toBe("/api/analytics/review-topics")
    expect(url.search).toBe("")
  })

  it("sends clientId and locationId as client_id and location_id", async () => {
    const clientId = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f"
    const fetchMock = stubFetch(() => json(zedOnlyReport()))
    renderWithProviders(
      <ReviewTopicsPanel clientId={clientId} locationId={ZED.id} />
    )
    await topicTable()
    const url = requestedUrl(fetchMock)
    expect(url.pathname).toBe("/api/analytics/review-topics")
    expect(url.searchParams.get("client_id")).toBe(clientId)
    expect(url.searchParams.get("location_id")).toBe(ZED.id)
  })

  it("sends client_id alone when only a client is chosen", async () => {
    const clientId = "3c2b1a09-8f7e-4d6c-9b5a-4e3d2c1b0a9f"
    const fetchMock = stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel clientId={clientId} />)
    await topicTable()
    const url = requestedUrl(fetchMock)
    expect(url.searchParams.get("client_id")).toBe(clientId)
    expect(url.searchParams.has("location_id")).toBe(false)
  })
})

describe("ReviewTopicsPanel loading and failure", () => {
  it("shows a loading state until the report arrives", async () => {
    let resolve!: (response: Response) => void
    stubFetch(
      () =>
        new Promise<Response>((r) => {
          resolve = r
        })
    )
    renderWithProviders(<ReviewTopicsPanel />)
    const loading = within(panel()).getByRole("status")
    expect(loading).toHaveTextContent(/loading review topics/i)
    expect(loading).toHaveAttribute("aria-busy", "true")
    expect(within(panel()).queryByRole("table")).not.toBeInTheDocument()
    await waitFor(() => expect(resolve).toBeTypeOf("function"))
    resolve(json(twoListingReport()))
    await topicTable()
    expect(loading).not.toBeInTheDocument()
    expect(screen.queryByText(/loading review topics/i)).not.toBeInTheDocument()
  })

  it("shows an error with a retry that fetches again", async () => {
    const fetchMock = stubFetch(
      () => json({ error: "internal_error", message: "down" }, 500),
      () => json(twoListingReport())
    )
    const user = userEvent.setup()
    renderWithProviders(<ReviewTopicsPanel />)
    const alert = await within(panel()).findByRole("alert")
    expect(alert).toHaveTextContent("We could not load this report")
    expect(within(panel()).queryByRole("table")).not.toBeInTheDocument()
    expect(
      within(panel()).queryByRole("button", { name: /download csv/i })
    ).not.toBeInTheDocument()

    await user.click(within(alert).getByRole("button", { name: "Try again" }))
    await topicTable()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(within(panel()).queryByRole("alert")).not.toBeInTheDocument()
  })
})

describe("ReviewTopicsPanel with nothing read yet", () => {
  it("draws nothing for a scope with no listings: the report above says so", async () => {
    const fetchMock = stubFetch(() => json(report({ locations: [] })))
    const { container } = renderWithProviders(<ReviewTopicsPanel />)
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() =>
      expect(
        screen.queryByRole("heading", { name: "What guests talk about" })
      ).not.toBeInTheDocument()
    )
    expect(container.querySelector("section")).toBeNull()
  })

  it("says no reviews are read yet and how many are waiting, with no CSV", async () => {
    stubFetch(() =>
      json(report({ locations: [ZED, ALPHA], pendingReviews: 4 }))
    )
    renderWithProviders(<ReviewTopicsPanel />)
    expect(
      await screen.findByText("No reviews sorted into topics yet")
    ).toBeInTheDocument()
    expect(
      screen.getByText(/4 reviews with text are waiting to be sorted/)
    ).toBeInTheDocument()
    expect(within(panel()).queryByRole("table")).not.toBeInTheDocument()
    expect(
      within(panel()).queryByRole("button", { name: /download csv/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Topic by listing" })
    ).not.toBeInTheDocument()
  })
})

describe("ReviewTopicsPanel topic table", () => {
  it("lists only mentioned topics, most mentioned first", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    const rows = bodyRows(await topicTable())
    expect(rows).toHaveLength(3)
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[0].textContent)
    ).toEqual(["Food quality", "Service", "Drinks"])
  })

  it("links each topic to the inbox filtered to it", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    const table = await topicTable()
    expect(
      within(table).getByRole("link", { name: /^Food quality/ })
    ).toHaveAttribute("href", inbox("food_quality"))
    expect(
      within(table).getByRole("link", { name: /^Drinks/ })
    ).toHaveAttribute("href", inbox("drinks"))
    expect(
      within(table).getByRole("link", { name: /^Service/ })
    ).toHaveAttribute("href", inbox("service"))
  })

  it("adds the listing to each inbox link when scoped to one listing", async () => {
    stubFetch(() => json(zedOnlyReport()))
    renderWithProviders(<ReviewTopicsPanel locationId={ZED.id} />)
    const table = await topicTable()
    expect(
      within(table).getByRole("link", { name: /^Food quality/ })
    ).toHaveAttribute("href", inbox("food_quality", { locationId: ZED.id }))
    expect(
      within(table).getByRole("link", { name: /^Service/ })
    ).toHaveAttribute("href", inbox("service", { locationId: ZED.id }))
  })

  it("shows the share with its count and the negative share as percentages", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    const [food, service, drinks] = bodyRows(await topicTable())
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole("cell")
        .map((cell) => cell.textContent)
    expect(cells(food).slice(1, 3)).toEqual(["50% (3)", "33%"])
    expect(cells(drinks).slice(1, 3)).toEqual(["17% (1)", "0%"])
    expect(cells(service).slice(1, 3)).toEqual(["33% (2)", "100%"])
  })

  it("draws a sparkline per row named with its weekly figures and negatives", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    const [food, service, drinks] = bodyRows(await topicTable())
    const spark = (row: HTMLElement) => within(row).getByRole("img")
    expect(spark(food)).toHaveAccessibleName(
      "Mentions per week over the last 8 weeks, oldest first: 0, 0, 0, 0, 0, 0, 1 (1 negative), 2"
    )
    expect(spark(drinks)).toHaveAccessibleName(
      "Mentions per week over the last 8 weeks, oldest first: 0, 0, 0, 0, 0, 1, 0, 0"
    )
    expect(spark(drinks).getAttribute("aria-label")).not.toMatch(/negative/)
    expect(spark(service)).toHaveAccessibleName(
      /^Mentions per week over the last 8 weeks.*, 2 \(2 negative\)$/
    )
  })

  it("names the topics nobody mentioned in one line", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    expect(
      screen.getByText(
        "Not mentioned: Wait time, Price and value, Atmosphere, Cleanliness, Booking, Sunday roast, Events and live sport, Dogs and families, Accessibility, Parking."
      )
    ).toBeInTheDocument()
  })

  it("says how many reviews the figures come from", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    const caption = screen.getByText(/^From 6 reviews with text\./)
    expect(caption).toHaveTextContent(
      /^From 6 reviews with text\. Mentioned in:/
    )
    expect(caption).not.toHaveTextContent(/waiting to be sorted/)
  })

  it("adds how many are still waiting to be sorted", async () => {
    stubFetch(() => json(twoListingReport(5)))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    expect(screen.getByText(/^From 6 reviews with text\./)).toHaveTextContent(
      "From 6 reviews with text. 5 more are waiting to be sorted."
    )
  })

  it("offers the CSV download once there is data", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    expect(
      within(panel()).getByRole("button", { name: /^Download CSV/ })
    ).toBeInTheDocument()
  })

  it("downloads every scope's topics with the Venue,Topic header", async () => {
    const blobs: Blob[] = []
    vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      blobs.push(blob as Blob)
      return "blob:test"
    })
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    stubFetch(() => json(twoListingReport()))
    const user = userEvent.setup()
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    await user.click(
      within(panel()).getByRole("button", { name: /^Download CSV/ })
    )
    expect(blobs).toHaveLength(1)
    const text = (await blobs[0].text()).replace(/^\uFEFF/, "")
    // Every cell is quoted; none of these contain quotes or commas.
    const lines = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "")))
    expect(lines[0].slice(0, 2)).toEqual(["Venue", "Topic"])
    expect(lines[0]).toContain(`Week of ${WEEKS[0]}`)
    expect(lines[0].at(-1)).toBe(`Week of ${WEEKS[7]}`)
    // Header, then 13 topics for the group and for each of two listings.
    expect(lines).toHaveLength(1 + 13 * 3)
    const row = (venue: string, topic: string) =>
      lines.find((line) => line[0] === venue && line[1] === topic)
    expect(row("All venues", "Food quality")?.slice(2, 4)).toEqual(["6", "3"])
    expect(row("Zed Tavern", "Food quality")?.slice(2, 4)).toEqual(["4", "2"])
    expect(row("Alpha Inn", "Drinks")?.slice(2, 4)).toEqual(["2", "1"])
    window.dispatchEvent(new Event("pagehide"))
  })
})

describe("ReviewTopicsPanel by listing", () => {
  function byListing() {
    return screen.getByRole("region", { name: "Topic by listing" })
  }

  it("compares listings on the most-mentioned topic, most mentions first", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    expect(
      await screen.findByRole("heading", { level: 3, name: "Topic by listing" })
    ).toBeInTheDocument()
    expect(
      within(byListing()).getByRole("combobox", { name: "Topic" })
    ).toHaveTextContent("Food quality")
    const rows = bodyRows(within(byListing()).getByRole("table"))
    expect(rows).toHaveLength(2)
    // Zed (2 mentions) before Alpha (1), against the alphabet.
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[0].textContent)
    ).toEqual(["Zed Tavern", "Alpha Inn"])
    // The name opens the listing's report, as in the Reply tab's table;
    // the count opens those reviews.
    expect(
      within(rows[0]).getByRole("link", { name: "Zed Tavern" })
    ).toHaveAttribute("href", `/reports?locationId=${ZED.id}`)
    expect(
      within(rows[0]).getByRole("link", {
        name: /food quality mentions at Zed Tavern/,
      })
    ).toHaveAttribute("href", inbox("food_quality", { locationId: ZED.id }))
    expect(
      within(rows[1]).getByRole("link", {
        name: /food quality mentions at Alpha Inn/,
      })
    ).toHaveAttribute("href", inbox("food_quality", { locationId: ALPHA.id }))
    const cells = within(rows[0])
      .getAllByRole("cell")
      .map((cell) => cell.textContent)
    expect(cells.slice(1, 3)).toEqual(["50% (2)", "0%"])
  })

  it("re-orders and re-links when another topic is chosen; no link without mentions", async () => {
    stubFetch(() => json(twoListingReport()))
    const user = userEvent.setup()
    renderWithProviders(<ReviewTopicsPanel />)
    await screen.findByRole("heading", { level: 3, name: "Topic by listing" })
    await user.click(
      within(byListing()).getByRole("combobox", { name: "Topic" })
    )
    await user.click(await screen.findByRole("option", { name: "Drinks" }))
    await waitFor(() =>
      expect(
        within(byListing()).getByRole("combobox", { name: "Topic" })
      ).toHaveTextContent("Drinks")
    )
    const rows = bodyRows(within(byListing()).getByRole("table"))
    expect(
      rows.map((row) => within(row).getAllByRole("cell")[0].textContent)
    ).toEqual(["Alpha Inn", "Zed Tavern"])
    expect(
      within(rows[0]).getByRole("link", {
        name: /drinks mentions at Alpha Inn/,
      })
    ).toHaveAttribute("href", inbox("drinks", { locationId: ALPHA.id }))
    // Zed never mentioned drinks: no link to an empty inbox, only its report.
    expect(
      within(rows[1])
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"))
    ).toEqual([`/reports?locationId=${ZED.id}`])
    expect(within(rows[1]).queryByRole("img")).not.toBeInTheDocument()
  })

  it("is not shown when the panel is scoped to one listing", async () => {
    stubFetch(() => json(twoListingReport()))
    renderWithProviders(<ReviewTopicsPanel locationId={ZED.id} />)
    await topicTable()
    expect(
      screen.queryByRole("heading", { name: "Topic by listing" })
    ).not.toBeInTheDocument()
    expect(within(panel()).getAllByRole("table")).toHaveLength(1)
  })

  it("is not shown when there is only one listing", async () => {
    stubFetch(() => json(zedOnlyReport()))
    renderWithProviders(<ReviewTopicsPanel />)
    await topicTable()
    expect(
      screen.queryByRole("heading", { name: "Topic by listing" })
    ).not.toBeInTheDocument()
  })
})
