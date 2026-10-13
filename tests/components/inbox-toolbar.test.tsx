import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { InboxToolbar } from "@/components/inbox/inbox-toolbar"
import { SEARCH_FOCUS_EVENT } from "@/lib/inbox/events"
import type { InboxState } from "@/lib/inbox/url-state"

const state: InboxState = {
  queue: "needs_reply",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
}

function renderToolbar(resultLabel = "7 reviews") {
  return render(
    <InboxToolbar
      state={state}
      counts={undefined}
      countsPending
      locations={[]}
      clients={[]}
      showLocationFilter={false}
      resultLabel={resultLabel}
      onFilterChange={vi.fn()}
      onQueueChange={vi.fn()}
      onClear={vi.fn()}
    />
  )
}

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
})
