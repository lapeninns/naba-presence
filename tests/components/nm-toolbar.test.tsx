import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { FilterChip } from "@/components/ui/chip"
import { FilterButton, Toolbar } from "@/components/ui/toolbar"

/** A viewport that is (or is not) the `desk` layout. */
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

describe("Toolbar", () => {
  it("renders a 44px pill search field with a clear button", async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    render(
      <Toolbar
        searchLabel="Search reviews"
        defaultSearchValue=""
        onSearchChange={onSearchChange}
      />
    )
    expect(screen.getByRole("search")).toBeInTheDocument()
    const field = screen.getByRole("searchbox", { name: "Search reviews" })
    const wrapper = field.closest('[data-slot="input-search"]')!
    expect(wrapper.className).toContain("h-(--np-touch)")
    expect(wrapper.className).toContain("rounded-(--np-radius-pill)")
    expect(wrapper.className).toContain("bg-fill-secondary")
    await user.type(field, "slow")
    expect(field).toHaveValue("slow")
    expect(onSearchChange).toHaveBeenLastCalledWith("slow")
    await user.click(screen.getByRole("button", { name: "Clear search" }))
    expect(field).toHaveValue("")
    expect(onSearchChange).toHaveBeenLastCalledWith("")
  })

  it("follows a controlled value", async () => {
    const user = userEvent.setup()
    function Controlled() {
      const [value, setValue] = React.useState("roast")
      return (
        <>
          <Toolbar searchValue={value} onSearchChange={setValue} />
          <output>{value}</output>
        </>
      )
    }
    render(<Controlled />)
    const field = screen.getByRole("searchbox", { name: "Search" })
    expect(field).toHaveValue("roast")
    await user.type(field, "s")
    expect(document.querySelector("output")).toHaveTextContent("roasts")
  })

  it("shows the filter and view slots and the chip row only with chips", () => {
    const { rerender } = render(
      <Toolbar
        filter={<FilterButton />}
        view={<button type="button">List view</button>}
      />
    )
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "List view" })
    ).toBeInTheDocument()
    expect(document.querySelector('[data-slot="toolbar-chips"]')).toBeNull()
    rerender(
      <Toolbar
        filter={<FilterButton count={1} />}
        chips={[
          <FilterChip key="r" onRemove={() => {}}>
            5★
          </FilterChip>,
        ]}
      />
    )
    expect(document.querySelector('[data-slot="toolbar-chips"]')).not.toBeNull()
    expect(
      screen.getByRole("button", { name: "Remove filter: 5★" })
    ).toBeInTheDocument()
  })

  it("announces the results label politely", () => {
    render(<Toolbar resultsLabel="24 reviews" />)
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("24 reviews")
    expect(status.className).toContain("text-ink-muted")
  })

  it("is a sticky band by default", () => {
    const { container } = render(<Toolbar />)
    const band = container.querySelector('[data-slot="toolbar"]')!
    expect(band.className).toContain("sticky")
    expect(band.className).toContain("z-sticky")
  })

  it("enters search mode on focus on touch, and Cancel exits and restores focus", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    const onSearchModeChange = vi.fn()
    render(
      <Toolbar
        header={<h1>Inbox</h1>}
        filter={<FilterButton count={2} />}
        onSearchModeChange={onSearchModeChange}
      />
    )
    const field = screen.getByRole("searchbox", { name: "Search" })
    await user.click(field)
    expect(onSearchModeChange).toHaveBeenLastCalledWith(true)
    // The header and the filter step aside for the field and Cancel.
    expect(screen.queryByRole("heading", { name: "Inbox" })).toBeNull()
    expect(screen.queryByRole("button", { name: /Filters/ })).toBeNull()
    expect(field).toHaveFocus()
    await user.type(field, "slow")
    const cancel = screen.getByRole("button", { name: "Cancel" })
    expect(cancel.className).toContain("min-h-(--np-touch)")
    await user.click(cancel)
    expect(onSearchModeChange).toHaveBeenLastCalledWith(false)
    expect(field).toHaveValue("")
    expect(screen.getByRole("heading", { name: "Inbox" })).toBeInTheDocument()
    // Nothing was focused before the tap, so focus lands on Filters.
    expect(
      screen.getByRole("button", { name: "Filters, 2 active" })
    ).toHaveFocus()
  })

  it("Escape leaves search mode and returns focus to where it came from", async () => {
    mockDesk(false)
    const user = userEvent.setup()
    render(
      <>
        <button type="button">Before</button>
        <Toolbar filter={<FilterButton />} />
      </>
    )
    screen.getByRole("button", { name: "Before" }).focus()
    await user.tab()
    const field = screen.getByRole("searchbox", { name: "Search" })
    expect(field).toHaveFocus()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    expect(screen.getByRole("button", { name: "Before" })).toHaveFocus()
  })

  it("stays out of search mode on a desk", async () => {
    mockDesk(true)
    const user = userEvent.setup()
    render(<Toolbar filter={<FilterButton />} />)
    await user.click(screen.getByRole("searchbox", { name: "Search" }))
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull()
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument()
  })

  it("can be put in search mode from outside, focusing the field", () => {
    render(<Toolbar searchMode filter={<FilterButton />} />)
    expect(screen.getByRole("searchbox", { name: "Search" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument()
  })
})

describe("FilterButton", () => {
  it("is a 44px circle named Filters", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<FilterButton onClick={onClick} />)
    const button = screen.getByRole("button", { name: "Filters" })
    expect(button.className).toContain("size-(--np-control-h)")
    expect(button.className).toContain("rounded-(--np-radius-pill)")
    expect(button).not.toHaveAttribute("data-active")
    await user.click(button)
    expect(onClick).toHaveBeenCalled()
  })

  it("says how many filters are active and tints the icon", () => {
    render(<FilterButton count={3} />)
    const button = screen.getByRole("button", { name: "Filters, 3 active" })
    expect(button).toHaveAttribute("data-active")
    expect(button.querySelector("svg")!.getAttribute("class")).toContain(
      "text-accent-ink"
    )
    const badge = button.querySelector('[data-slot="filter-button-count"]')!
    expect(badge).toHaveTextContent("3")
    expect(badge).toHaveAttribute("aria-hidden", "true")
  })
})
