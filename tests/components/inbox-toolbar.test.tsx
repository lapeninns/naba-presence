import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InboxToolbar } from "@/components/inbox/inbox-toolbar"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import type { InboxState } from "@/lib/inbox/url-state"

const state: InboxState = {
  queue: "needs_reply",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
}

function renderToolbar(
  resultLabel = "7 reviews",
  overrides: Partial<Parameters<typeof InboxToolbar>[0]> = {}
) {
  const props = {
    state,
    counts: undefined,
    countsPending: true,
    locations: [],
    clients: [],
    showLocationFilter: false,
    resultLabel,
    onFilterChange: vi.fn(),
    onQueueChange: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  }
  return { ...render(<InboxToolbar {...props} />), props }
}

function counts(needsReply: number): ReviewCounts {
  return {
    total: needsReply + 3,
    byStatus: {},
    byQueue: {
      needs_reply: needsReply,
      approval: 1,
      awaiting_my_approval: 1,
      awaiting_others: 0,
      publishing: 0,
      failed: 2,
      done: 0,
      all: needsReply + 3,
    },
  }
}

function header() {
  return document.querySelector<HTMLElement>('[data-slot="inbox-toolbar"]')!
}

/**
 * A viewport that is (or is not) the `desk` layout: a touch layout is where
 * the Toolbar's search mode takes over. jsdom has no matchMedia, which reads
 * as the desk.
 */
function mockDesk(desk: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: desk,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }))
  )
}

afterEach(() => vi.unstubAllGlobals())

describe("InboxToolbar", () => {
  it("has exactly one search entry point, named Search reviews", () => {
    // The shell's launcher does not look inside review text, so this field
    // is the one place to search it, at every width.
    renderToolbar()
    const searches = screen.getAllByRole("searchbox")
    expect(searches).toHaveLength(1)
    expect(searches[0]).toHaveAccessibleName("Search reviews")
    expect(searches[0]).toHaveAttribute("placeholder", "Search reviews")
  })

  it("puts the caret in the search when the / hotkey asks", async () => {
    renderToolbar()
    await act(async () => {
      window.dispatchEvent(new Event(SEARCH_FOCUS_EVENT))
      await new Promise((resolve) => requestAnimationFrame(resolve))
    })
    expect(
      screen.getByRole("searchbox", { name: "Search reviews" })
    ).toHaveFocus()
  })

  it("threads the list's count into the Filters sheet", async () => {
    const user = userEvent.setup()
    renderToolbar("7 reviews")
    await user.click(screen.getByRole("button", { name: /^Filters/ }))
    const sheet = await screen.findByRole("dialog", { name: "Filters" })
    expect(
      within(sheet).getByRole("button", { name: "Show 7 reviews" })
    ).toBeInTheDocument()
  })

  it("follows the title with the needs-reply count, keeping the heading's name", () => {
    renderToolbar("7 reviews", { counts: counts(12), countsPending: false })
    const heading = screen.getByRole("heading", { level: 1, name: "Inbox" })
    // ViewHeader's count slot, after the h1 on the same line.
    const count = header().querySelector('[data-slot="view-header-count"]')
    expect(count).toBeInTheDocument()
    // Beside the h1, not inside it: the heading stays "Inbox".
    expect(heading).not.toContainElement(count as HTMLElement)
    expect(heading.parentElement).toContainElement(count as HTMLElement)
    expect(count).toHaveClass(
      "text-count",
      "font-normal",
      "text-ink-muted",
      "tabular-nums"
    )
    expect(count?.className).not.toMatch(/font-mono/)
    const figure = count!.querySelector("[aria-hidden]")
    expect(figure).toHaveTextContent("12")
    expect(within(header()).getByText("(12 need a reply)")).toHaveClass(
      "sr-only"
    )
  })

  it("says one review needs a reply in the singular", () => {
    renderToolbar("7 reviews", { counts: counts(1), countsPending: false })
    expect(within(header()).getByText("(1 needs a reply)")).toBeInTheDocument()
  })

  it("shows a skeleton, never a zero, while the counts are in flight", () => {
    renderToolbar()
    const count = header().querySelector('[data-slot="view-header-count"]')
    const skeleton = count?.querySelector('[data-slot="skeleton"]')
    expect(skeleton).toBeInTheDocument()
    expect(skeleton?.getAttribute("aria-hidden")).toBe("true")
    expect(count?.textContent).toBe("")
    expect(
      screen.getByRole("heading", { level: 1, name: "Inbox" }).parentElement
        ?.textContent
    ).toBe("Inbox")
  })

  it("shows no figure when nothing needs a reply", () => {
    renderToolbar("7 reviews", { counts: counts(0), countsPending: false })
    expect(header().querySelector('[data-slot="view-header-count"]')).toBeNull()
    expect(screen.queryByText(/need(s)? a reply/)).toBeNull()
  })

  it("keeps the title a paragraph when the open review owns the h1", () => {
    renderToolbar("7 reviews", { titleIsHeading: false })
    expect(screen.queryByRole("heading", { level: 1 })).toBeNull()
    expect(screen.getByText("Inbox").tagName).toBe("P")
  })

  it("draws the search as a filled pill", () => {
    renderToolbar()
    const field = screen
      .getByRole("searchbox", { name: "Search reviews" })
      .closest('[data-slot="input-search"]')
    expect(field).toHaveClass(
      "rounded-(--np-radius-pill)",
      "bg-fill-secondary",
      "border-transparent"
    )
  })

  it("enters phone search mode on focus: title, filters and queues fold, Cancel and the results label appear", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    renderToolbar("12 reviews")
    expect(header()).not.toHaveAttribute("data-search-mode")
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()

    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))

    expect(header()).toHaveAttribute("data-search-mode")
    // The Toolbar's own Cancel: a 44px text button beside the field.
    const cancel = screen.getByRole("button", { name: "Cancel" })
    expect(cancel).toHaveAttribute("data-slot", "toolbar-cancel")
    expect(cancel).toHaveClass("min-h-(--np-touch)")
    expect(
      screen.getByRole("navigation", { name: "Review queues" })
    ).toHaveClass("hidden")
    // The filter end steps aside while the field has the row.
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull()
    // Folded for the eye only: the h1 is still the page's heading.
    const titleRow = header().querySelector('[data-slot="inbox-title-row"]')
    expect(titleRow).toHaveClass("sr-only")
    expect(
      screen.getByRole("heading", { level: 1, name: "Inbox" })
    ).toBeInTheDocument()
    const results = header().querySelector('[data-slot="inbox-search-results"]')
    expect(results).toHaveTextContent("Results · 12 reviews")
    expect(results).toHaveClass("text-ui", "text-ink-muted")
    // Not live: the list header announces the count.
    expect(results).not.toHaveAttribute("role")
  })

  it("never takes over the desk: focus and a search in force leave the band as it is", async () => {
    mockDesk(true)
    const user = userEvent.setup()
    renderToolbar("3 reviews", { state: { ...state, search: "slow" } })
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    expect(header()).not.toHaveAttribute("data-search-mode")
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    expect(screen.getByRole("button", { name: /^Filters/ })).toBeInTheDocument()
    expect(
      screen.getByRole("navigation", { name: "Review queues" })
    ).not.toHaveClass("hidden")
    expect(
      header().querySelector('[data-slot="inbox-title-row"]')
    ).not.toHaveClass("sr-only")
  })

  it("stays in search mode when the field loses focus, until Cancel", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    renderToolbar()
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    await user.tab()
    expect(header()).toHaveAttribute("data-search-mode")

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(header()).not.toHaveAttribute("data-search-mode")
    expect(
      screen.getByRole("navigation", { name: "Review queues" })
    ).not.toHaveClass("hidden")
    expect(
      screen.getByRole("searchbox", { name: "Search reviews" })
    ).not.toHaveFocus()
  })

  it("ends an empty search's takeover when a review opens, so the queues are back on return", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    const { rerender, props } = renderToolbar()
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    await user.tab()
    expect(header()).toHaveAttribute("data-search-mode")
    // A phone opens a review: its head takes the h1 ...
    rerender(<InboxToolbar {...props} titleIsHeading={false} />)
    // ... and Back gives the h1 back to the inbox, queues unfolded.
    rerender(<InboxToolbar {...props} titleIsHeading />)
    expect(header()).not.toHaveAttribute("data-search-mode")
    expect(
      screen.getByRole("navigation", { name: "Review queues" })
    ).not.toHaveClass("hidden")
    expect(props.onFilterChange).not.toHaveBeenCalled()
  })

  it("keeps a typed search's takeover when a review opens and closes", () => {
    mockDesk(false)
    const { rerender, props } = renderToolbar("3 reviews", {
      state: { ...state, search: "slow" },
    })
    rerender(<InboxToolbar {...props} titleIsHeading={false} />)
    rerender(<InboxToolbar {...props} titleIsHeading />)
    expect(header()).toHaveAttribute("data-search-mode")
  })

  it("arrives in search mode with a search in force, and Cancel clears it through the filter path", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    const { props } = renderToolbar("3 reviews", {
      state: { ...state, search: "slow" },
    })
    expect(header()).toHaveAttribute("data-search-mode")
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(props.onFilterChange).toHaveBeenCalledWith({ search: "" })
    expect(
      screen.getByRole("searchbox", { name: "Search reviews" })
    ).toHaveValue("")
  })

  it("Escape leaves search mode the way Cancel does", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    const { props } = renderToolbar("3 reviews", {
      state: { ...state, search: "slow" },
    })
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    await user.keyboard("{Escape}")
    expect(props.onFilterChange).toHaveBeenCalledWith({ search: "" })
    expect(
      screen.getByRole("searchbox", { name: "Search reviews" })
    ).toHaveValue("")
  })

  it("Cancel with nothing typed changes no filter", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    const { props } = renderToolbar()
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(props.onFilterChange).not.toHaveBeenCalled()
  })
})
