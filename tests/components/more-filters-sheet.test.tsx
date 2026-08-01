import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MoreFiltersSheet } from "@/components/inbox/more-filters-sheet"
import type { InboxState } from "@/lib/inbox/url-state"

const baseState: InboxState = {
  queue: "all",
  ratings: [],
  search: "",
  sort: "updated_desc",
  verification: [],
  publishStatus: [],
  syncStatus: [],
}

afterEach(() => vi.restoreAllMocks())

describe("MoreFiltersSheet", () => {
  it("shows a count of active advanced filters on the trigger", () => {
    render(
      <MoreFiltersSheet
        state={{ ...baseState, verification: ["fail"], syncStatus: ["failed"] }}
        onChange={() => {}}
      />
    )
    // 2 active advanced filters (verification + syncStatus)
    expect(screen.getByRole("button", { name: /More filters/ })).toHaveTextContent("2")
  })

  it("toggles a verification value into the URL state", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MoreFiltersSheet state={baseState} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    await user.click(screen.getByRole("checkbox", { name: "Failed" }))
    expect(onChange).toHaveBeenCalledWith({ verification: ["fail"] })
  })

  it("sets a date range", async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<MoreFiltersSheet state={baseState} onChange={onChange} />)
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    const from = screen.getByLabelText("From date")
    await user.type(from, "2026-07-01")
    expect(onChange).toHaveBeenCalledWith({
      dateFrom: "2026-07-01T00:00:00.000Z",
    })
  })

  it("reflects an already-active date range from URL state in the inputs", async () => {
    const user = userEvent.setup()
    const { rerender } = render(
      <MoreFiltersSheet
        state={{
          ...baseState,
          dateFrom: "2026-07-01T00:00:00.000Z",
          dateTo: "2026-07-15T00:00:00.000Z",
        }}
        onChange={() => {}}
      />
    )
    await user.click(screen.getByRole("button", { name: /More filters/ }))
    expect(screen.getByLabelText("From date")).toHaveValue("2026-07-01")
    expect(screen.getByLabelText("To date")).toHaveValue("2026-07-15")

    // Clearing the date filter (e.g. via the chip or "Clear filters") updates
    // the URL, which flows back in as a state prop with no dateFrom/dateTo —
    // the inputs must go blank rather than keep showing stale dates.
    rerender(<MoreFiltersSheet state={baseState} onChange={() => {}} />)
    expect(screen.getByLabelText("From date")).toHaveValue("")
    expect(screen.getByLabelText("To date")).toHaveValue("")
  })
})
