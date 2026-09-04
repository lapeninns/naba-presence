import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewFilters } from "@/components/inbox/review-filters"
import type { InboxState } from "@/lib/inbox/url-state"

const baseState: InboxState = {
  queue: "all",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
  verification: [],
  publishStatus: [],
  syncStatus: [],
}

function renderFilters(
  state: InboxState = baseState,
  onChange: (partial: Partial<InboxState>) => void = () => {}
) {
  return render(
    <ReviewFilters
      state={state}
      locations={[{ id: "loc-1", name: "Riverside" }]}
      onChange={onChange}
      onClear={() => {}}
    />
  )
}

afterEach(() => vi.restoreAllMocks())

describe("ReviewFilters — inline filters (no sidebar)", () => {
  it("keeps rating and reply filters visible without opening a panel", () => {
    renderFilters()
    expect(screen.getByRole("checkbox", { name: "5 stars" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Any" })).toBeChecked()
    expect(screen.getByRole("button", { name: /More filters/ })).toBeInTheDocument()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  })

  it("toggles a star rating into the URL state", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFilters(baseState, onChange)
    await user.click(screen.getByRole("checkbox", { name: "5 stars" }))
    expect(onChange).toHaveBeenCalledWith({ ratings: [5] })
  })

  it("supports multi-star ratings from Home deep-links", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFilters({ ...baseState, ratings: [1, 2] }, onChange)
    expect(screen.getByRole("checkbox", { name: "1 star" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "2 stars" })).toBeChecked()
    expect(screen.getByRole("checkbox", { name: "5 stars" })).not.toBeChecked()
    await user.click(screen.getByRole("checkbox", { name: "1 star" }))
    expect(onChange).toHaveBeenCalledWith({ ratings: [2] })
  })

  it("expands advanced filters inline and toggles verification", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFilters(baseState, onChange)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    expect(screen.getByRole("checkbox", { name: "Failed" })).toBeInTheDocument()
    await user.click(screen.getByRole("checkbox", { name: "Failed" }))
    expect(onChange).toHaveBeenCalledWith({ verification: ["fail"] })
  })

  it("shows a count of active advanced filters on the More toggle", () => {
    renderFilters({
      ...baseState,
      verification: ["fail"],
      syncStatus: ["failed"],
    })
    // Auto-expands when advanced filters are already active; badge still shows.
    expect(screen.getByRole("button", { name: /More filters/ })).toHaveTextContent("2")
  })

  it("does not count always-visible rating toward the More badge", () => {
    renderFilters({ ...baseState, ratings: [3] })
    expect(screen.getByRole("button", { name: /More filters/ })).not.toHaveTextContent("1")
  })

  it("sets a date range from the expanded panel", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    renderFilters(baseState, onChange)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    const from = screen.getByLabelText("From date")
    await user.type(from, "2026-07-01")
    expect(onChange).toHaveBeenCalledWith({
      dateFrom: "2026-07-01T00:00:00.000Z",
    })
  })

  it("reflects an already-active date range from URL state in the inputs", async () => {
    const { rerender } = renderFilters({
      ...baseState,
      dateFrom: "2026-07-01T00:00:00.000Z",
      dateTo: "2026-07-15T00:00:00.000Z",
    })
    // Advanced panel auto-opens when a date filter is active.
    expect(screen.getByLabelText("From date")).toHaveValue("2026-07-01")
    expect(screen.getByLabelText("To date")).toHaveValue("2026-07-15")

    rerender(
      <ReviewFilters
        state={baseState}
        locations={[{ id: "loc-1", name: "Riverside" }]}
        onChange={() => {}}
        onClear={() => {}}
      />
    )
    // Panel may stay open; cleared URL state blanks the inputs.
    expect(screen.getByLabelText("From date")).toHaveValue("")
    expect(screen.getByLabelText("To date")).toHaveValue("")
  })
})
