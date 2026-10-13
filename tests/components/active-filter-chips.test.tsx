import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActiveFilterChips } from "@/components/inbox/active-filter-chips"
import type { InboxState } from "@/lib/inbox/url-state"

const state: InboxState = {
  queue: "all",
  locationIds: ["loc-1"],
  ratings: [5],
  search: "slow",
  sort: "updated_desc",
}

afterEach(() => vi.restoreAllMocks())

describe("ActiveFilterChips", () => {
  it("shows and clears the rating-only filter", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ActiveFilterChips
        state={{
          ...state,
          locationIds: [],
          ratings: [],
          search: "",
          written: "rating_only",
        }}
        locations={[]}
        onChange={onChange}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Written review: Rating only")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "Remove filter: Written review: Rating only",
      })
    )
    expect(onChange).toHaveBeenCalledWith({ written: undefined })
  })

  it("renders a chip per active filter and clears one on request", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ActiveFilterChips
        state={state}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={onChange}
        onClear={() => {}}
      />
    )
    // Each chip names its filter as the Filters sheet heads it ("Venue",
    // not "Location"), and the whole chip is the remove control.
    expect(screen.getByText("Venue: Riverside")).toBeInTheDocument()
    expect(screen.getByText("Rating: 5 stars")).toBeInTheDocument()
    expect(screen.getByText('Search: "slow"')).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Remove filter: Venue: Riverside" })
    )
    expect(onChange).toHaveBeenCalledWith({ locationIds: [] })
  })

  it("humanizes a multi-value rating chip", () => {
    const { rerender } = render(
      <ActiveFilterChips
        state={{ ...state, locationIds: [], ratings: [1, 2], search: "" }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    // A run reads as a range, anything else as a list.
    expect(screen.getByText("Rating: 1–2 stars")).toBeInTheDocument()
    rerender(
      <ActiveFilterChips
        state={{ ...state, locationIds: [], ratings: [5, 1, 3], search: "" }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Rating: 1, 3, 5 stars")).toBeInTheDocument()
  })

  it("keeps the chip that clears a venue a single-location org cannot choose", async () => {
    // A stale `?locationId=` from a deep link must stay removable even when
    // the sheet hides the venue control.
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <ActiveFilterChips
        state={{ ...state, ratings: [], search: "" }}
        locations={[]}
        onChange={onChange}
        onClear={() => {}}
      />
    )
    await user.click(
      screen.getByRole("button", { name: "Remove filter: Venue: selected" })
    )
    expect(onChange).toHaveBeenCalledWith({ locationIds: [] })
  })

  it("offers Clear all when any filter is active", async () => {
    const user = userEvent.setup()
    const onClear = vi.fn()
    render(
      <ActiveFilterChips
        state={state}
        locations={[]}
        onChange={() => {}}
        onClear={onClear}
      />
    )
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("renders nothing when no filters are active", () => {
    const { container } = render(
      <ActiveFilterChips
        state={{ ...state, locationIds: [], ratings: [], search: "" }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("formats date ranges and non-default sort as chips", () => {
    render(
      <ActiveFilterChips
        state={{
          ...state,
          locationIds: [],
          ratings: [],
          search: "",
          dateFrom: "2026-07-09T00:00:00.000Z",
          dateTo: "2026-07-15T00:00:00.000Z",
          sort: "rating_asc",
        }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Date range: 9 Jul – 15 Jul")).toBeInTheDocument()
    expect(screen.getByText("Sort: Lowest rated")).toBeInTheDocument()
  })

  it("lays the chips in one scrolling row, never cutting a label, Clear all last", () => {
    const { container } = render(
      <ActiveFilterChips
        state={state}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    const row = container.querySelector('[data-slot="active-filter-chips"]')
    expect(row).toHaveClass("overflow-x-auto")
    expect(row).not.toHaveClass("flex-wrap")
    expect(row?.lastElementChild).toHaveAccessibleName("Clear all filters")
    const chips = row!.querySelectorAll('[data-slot="chip"]')
    expect(chips.length).toBe(3)
    for (const chip of Array.from(chips)) {
      expect(chip.tagName).toBe("BUTTON")
      expect(chip).toHaveAccessibleName(/^Remove filter: /)
      expect(chip).toHaveClass(
        "h-(--np-control-h-sm)",
        "bg-accent-tint",
        "text-accent-ink",
        "font-semibold"
      )
      // Drawn small; the touch extension, not the drawing, reaches 44px.
      expect(chip.className).not.toMatch(/pointer-coarse:h-/)
      expect(chip.querySelector(".truncate")).toBeNull()
      expect(chip).not.toHaveClass("max-w-full")
    }
  })
})
