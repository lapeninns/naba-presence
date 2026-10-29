import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
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
    // Rating is a pressed chip above the list, so it is not drawn twice.
    expect(screen.queryByText(/^Rating:/)).not.toBeInTheDocument()
    expect(screen.getByText("Search: “slow”")).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Remove filter: Venue: Riverside" })
    )
    expect(onChange).toHaveBeenCalledWith({ locationIds: [] })
  })

  // The strip goes with its last chip; `onEmpty` is where focus goes then
  // (the inbox sends it to the Filters button).
  it("hands focus to onEmpty when Clear all filters empties the strip", async () => {
    const user = userEvent.setup()
    const onEmpty = vi.fn()
    function Harness() {
      const [current, setCurrent] = useState<InboxState>({
        ...state,
        locationIds: [],
        ratings: [],
      })
      return (
        <ActiveFilterChips
          state={current}
          locations={[]}
          onChange={(partial) => setCurrent({ ...current, ...partial })}
          onClear={() => setCurrent({ ...current, search: "" })}
          onEmpty={onEmpty}
        />
      )
    }
    render(<Harness />)
    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    await waitFor(() => expect(onEmpty).toHaveBeenCalledTimes(1))
  })

  it("draws no chip and no Clear all for the client scope alone", () => {
    const { container } = render(
      <ActiveFilterChips
        state={{
          ...state,
          clientId: "c1",
          locationIds: [],
          ratings: [],
          search: "",
        }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("draws no client chip beside the filters that are on", () => {
    render(
      <ActiveFilterChips
        state={{ ...state, clientId: "c1" }}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Venue: Riverside")).toBeInTheDocument()
    expect(screen.queryByText(/Client/)).not.toBeInTheDocument()
  })

  it("draws a removable client chip when no switcher is shown", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    const onClear = vi.fn()
    render(
      <ActiveFilterChips
        state={{
          ...state,
          clientId: "c1",
          locationIds: [],
          ratings: [],
          search: "",
        }}
        locations={[]}
        clientChip={{ name: "Riverside Group", onRemove }}
        onChange={() => {}}
        onClear={onClear}
      />
    )
    expect(screen.getByText("Client: Riverside Group")).toBeInTheDocument()
    // The scope alone is not a filter, so there is nothing to "clear all" of.
    expect(
      screen.queryByRole("button", { name: "Clear all filters" })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole("button", {
        name: "Remove filter: Client: Riverside Group",
      })
    )
    expect(onRemove).toHaveBeenCalledTimes(1)
    expect(onClear).not.toHaveBeenCalled()
  })

  it("keeps Clear all beside the client chip when filters are on too", () => {
    render(
      <ActiveFilterChips
        state={{ ...state, clientId: "c1" }}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        clientChip={{ onRemove: () => {} }}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Client: selected")).toBeInTheDocument()
    expect(screen.getByText("Venue: Riverside")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear all filters" })
    ).toBeInTheDocument()
  })

  it("draws no client chip without a scope, whatever the caller passes", () => {
    const { container } = render(
      <ActiveFilterChips
        state={{ ...state, locationIds: [], ratings: [], search: "" }}
        locations={[]}
        clientChip={{ name: "Riverside Group", onRemove: () => {} }}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("leaves rating and With text to the chips above the list", () => {
    // They are pressed chips where they are set (QuickFilters), so this strip
    // does not name them a second time. "Clear all filters" still resets them.
    render(
      <ActiveFilterChips
        state={{
          ...state,
          locationIds: [],
          ratings: [1, 2],
          search: "",
          written: "with_text",
          assignee: "me",
        }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Assigned to: Me")).toBeInTheDocument()
    expect(screen.queryByText(/^Rating:/)).not.toBeInTheDocument()
    expect(screen.queryByText(/With text/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear all filters" })
    ).toBeInTheDocument()
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
    // The primitive FilterChip, applied: the whole chip removes it.
    const chips = row!.querySelectorAll('[data-slot="filter-chip"]')
    expect(chips.length).toBe(2)
    for (const chip of Array.from(chips)) {
      expect(chip.tagName).toBe("BUTTON")
      expect(chip).toHaveAccessibleName(/^Remove filter: /)
      expect(chip).toHaveAttribute("data-active")
      expect(chip.querySelector("svg")).toHaveAttribute("aria-hidden", "true")
      expect(chip).toHaveClass(
        "h-(--np-chip-h)",
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
