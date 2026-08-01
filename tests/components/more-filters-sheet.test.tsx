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
})
