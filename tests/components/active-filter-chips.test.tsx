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
    expect(screen.getByText("Location: Riverside")).toBeInTheDocument()
    expect(screen.getByText("Rating: 5 stars")).toBeInTheDocument()
    expect(screen.getByText('Search: "slow"')).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove location filter" }))
    expect(onChange).toHaveBeenCalledWith({ locationIds: [] })
  })

  it("humanizes a multi-value rating chip", () => {
    render(
      <ActiveFilterChips
        state={{ ...state, locationIds: [], ratings: [1, 2], search: "" }}
        locations={[]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    expect(screen.getByText("Rating: 1, 2 stars")).toBeInTheDocument()
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
    expect(screen.getByText("Date: 9 Jul – 15 Jul")).toBeInTheDocument()
    expect(screen.getByText("Sort: Lowest rated")).toBeInTheDocument()
  })
})
