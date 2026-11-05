import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, within } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { kindList, OutboxView } from "@/components/outbox/outbox-view"
import type {
  OutboxCounts,
  OutboxItem,
  OutboxResponse,
} from "@/lib/outbox/contract"
import { outboxStatus } from "@/lib/outbox/vocabulary"

const replace = vi.fn()
let search = new URLSearchParams()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => "/outbox",
  useSearchParams: () => search,
}))

const LOCATION = "11111111-1111-4111-8111-111111111111"
const CLIENT = "22222222-2222-4222-8222-222222222222"

function item(overrides: Partial<OutboxItem> = {}): OutboxItem {
  return {
    id: "reply:a",
    kind: "reply",
    state: "approval",
    title: "Reply to Sam K.",
    detail: "2-star review",
    locationId: LOCATION,
    locationName: "The Bell",
    clientId: CLIENT,
    clientName: "Journey Hospitality",
    at: new Date(Date.now() - 5 * 60_000).toISOString(),
    retryAt: null,
    href: `/inbox?queue=approval&selected=a`,
    ...overrides,
  }
}

const ROWS: OutboxItem[] = [
  item(),
  item({
    id: "listing_change:b",
    kind: "listing_change",
    state: "waiting",
    title: "Opening hours",
    detail: null,
    href: `/listings/${LOCATION}/hours`,
  }),
  item({
    id: "post:c",
    kind: "post",
    state: "failed",
    title: "Post",
    detail: "Quiz night every Thursday",
    href: `/listings/${LOCATION}/posts`,
  }),
  item({
    id: "reply:d",
    state: "live",
    title: "Reply to Ana P.",
    href: `/inbox?queue=done&selected=d`,
  }),
]

function page(overrides: Partial<OutboxResponse> = {}): OutboxResponse {
  return {
    items: ROWS,
    nextCursor: null,
    truncated: false,
    unavailable: [],
    paused: [],
    generatedAt: new Date().toISOString(),
    ...overrides,
  }
}

const COUNTS: OutboxCounts = {
  person: 1,
  google: 1,
  failed: 1,
  live: 1,
  partial: false,
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

function renderView(
  list: OutboxResponse | (() => Response),
  counts: OutboxCounts = COUNTS
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url.includes("/api/outbox/counts")) return json(counts)
    return typeof list === "function" ? list() : json(list)
  })
  vi.stubGlobal("fetch", fetchMock)
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <OutboxView />
    </QueryClientProvider>
  )
  return fetchMock
}

beforeEach(() => {
  search = new URLSearchParams()
  replace.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

describe("OutboxView", () => {
  it("lists rows in their groups, in reading order, each linking to the screen that acts", async () => {
    renderView(page())
    const headings = await screen.findAllByRole("heading", { level: 2 })
    expect(headings.map((h) => h.textContent)).toEqual([
      "Waiting for a person 1",
      "With Google 1",
      "Failed 1",
      "Confirmed today 1",
    ])
    const failed = screen.getByRole("region", { name: /^Failed/ })
    const link = within(failed).getByRole("link")
    expect(link).toHaveAttribute("href", `/listings/${LOCATION}/posts`)
    expect(link).toHaveTextContent("Retry sending")
    expect(link).toHaveTextContent(outboxStatus("failed").label)
  })

  it("links a failed removal to its details without promising a resend", async () => {
    renderView(
      page({
        items: [
          item({
            state: "failed",
            operation: "delete",
            href: "/inbox?queue=done&selected=a",
          }),
        ],
      })
    )
    const failed = await screen.findByRole("region", { name: /^Failed/ })
    const link = within(failed).getByRole("link", { name: /View details/ })
    expect(link).toHaveAttribute("href", "/inbox?queue=done&selected=a")
  })

  it("never calls a queued or unconfirmed write published, and only a confirmed one On Google", async () => {
    renderView(page())
    await screen.findAllByRole("heading", { level: 2 })
    expect(document.body.textContent).not.toMatch(/published|live/i)
    const google = screen.getByRole("region", { name: /^With Google/ })
    expect(google).toHaveTextContent(outboxStatus("waiting").label)
    expect(google).not.toHaveTextContent("On Google")
    const confirmed = screen.getByRole("region", { name: /^Confirmed today/ })
    expect(confirmed).toHaveTextContent(outboxStatus("live").label)
  })

  it("draws a non-zero Failed count in the danger ink and names it", async () => {
    renderView(page())
    const tab = await screen.findByRole("button", { name: "Failed, 1 item" })
    expect(tab.querySelector(".text-danger-ink")).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "All" }).getAttribute("aria-current")
    ).toBe("true")
  })

  it("keeps the group in the address", async () => {
    renderView(page())
    fireEvent.click(await screen.findByRole("button", { name: /^Failed/ }))
    expect(replace).toHaveBeenCalledWith("/outbox?group=failed", {
      scroll: false,
    })
  })

  it("shows a scheduled retry time", async () => {
    const at = new Date("2026-11-03T14:05:00Z")
    renderView(
      page({
        items: [
          item({ id: "reply:r", state: "retrying", retryAt: at.toISOString() }),
        ],
      })
    )
    const time = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(at)
    expect(
      await screen.findByText(outboxStatus("retrying", { time }).label)
    ).toBeInTheDocument()
  })

  it("says the list is incomplete when a source could not be read, and when sending is paused", async () => {
    renderView(page({ unavailable: ["post"], paused: ["reply", "bulk"] }))
    expect(
      await screen.findByText(/Posts could not be read/)
    ).toBeInTheDocument()
    expect(
      screen.getByText(/Replies and bulk changes wait here/)
    ).toBeInTheDocument()
  })

  it("shows an empty Outbox as nothing on its way, not as a failure", async () => {
    renderView(page({ items: [] }), {
      person: 0,
      google: 0,
      failed: 0,
      live: 0,
      partial: false,
    })
    expect(
      await screen.findByRole("heading", {
        name: "Nothing on its way to Google",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Go to the Inbox" })
    ).toHaveAttribute("href", "/inbox")
  })

  it("offers the whole Outbox from an empty group", async () => {
    search = new URLSearchParams("group=failed")
    renderView(page({ items: [] }))
    expect(
      await screen.findByRole("heading", { name: "Nothing in Failed" })
    ).toBeInTheDocument()
    expect(
      screen.getByText("Nothing else needs looking at here.")
    ).toBeInTheDocument()
    expect(screen.queryByText(/Older items may be missing/)).toBeNull()
    fireEvent.click(
      screen.getByRole("button", { name: "Show the whole Outbox" })
    )
    expect(replace).toHaveBeenCalledWith("/outbox", { scroll: false })
  })

  it("does not claim an empty Failed group is clear when older rows were capped", async () => {
    search = new URLSearchParams("group=failed")
    renderView(page({ items: [], truncated: true }), {
      person: 200,
      google: 0,
      failed: 0,
      live: 0,
      partial: true,
    })

    expect(
      await screen.findByRole("heading", {
        name: "No matches in the available results",
      })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/The list and counts include only the newest 200/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Older items may be missing/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", {
        name: "Failed, 0 items shown in the available results",
      })
    ).toHaveTextContent("0 shown")
    expect(screen.queryByText("Nothing else needs looking at here.")).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Nothing in Failed" })
    ).toBeNull()
  })

  it("qualifies counts from a capped source even when the list has rows", async () => {
    renderView(page({ truncated: true }), { ...COUNTS, partial: true })
    expect(
      await screen.findByRole("button", {
        name: "Failed, 1 item shown in the available results",
      })
    ).toHaveTextContent("1 shown")
  })

  it("says it is loading, and claims no rows or counts, until the first answer", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => {}))
    )
    const { container } = render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <OutboxView />
      </QueryClientProvider>
    )
    const status = await screen.findByRole("status")
    expect(status).toHaveTextContent("Loading the Outbox")
    expect(status).toHaveAttribute("aria-busy", "true")
    const failed = container.querySelector('[data-group="failed"]')!
    expect(failed).toHaveAttribute("aria-label", "Failed")
    expect(failed.querySelector('[data-slot="skeleton"]')).not.toBeNull()
    expect(screen.queryByRole("alert")).toBeNull()
    expect(
      screen.queryByRole("heading", { name: "Nothing on its way to Google" })
    ).toBeNull()
    expect(screen.queryByRole("link", { name: /Reply to/ })).toBeNull()
  })

  it("shows a failed load as an error with a retry", async () => {
    renderView(() => json({ error: { code: "internal" } }, 500))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The Outbox could not be loaded"
    )
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })

  it("names a client narrowing and clears it", async () => {
    search = new URLSearchParams(`clientId=${CLIENT}`)
    const fetchMock = renderView(page())
    const chip = await screen.findByRole("button", {
      name: /Remove filter: Only Journey Hospitality/,
    })
    expect(
      fetchMock.mock.calls.some(([url]) =>
        String(url).includes(`client_id=${CLIENT}`)
      )
    ).toBe(true)
    fireEvent.click(chip)
    expect(replace).toHaveBeenCalledWith("/outbox", { scroll: false })
  })
})

describe("kindList", () => {
  it("joins kinds as a sentence", () => {
    expect(kindList(["post"])).toBe("Posts")
    expect(kindList(["reply", "post", "bulk"])).toBe(
      "Replies, posts and bulk changes"
    )
  })
})
