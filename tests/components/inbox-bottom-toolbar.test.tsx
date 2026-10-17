import { readFileSync } from "node:fs"
import { join } from "node:path"

import { cleanup, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  InboxBottomToolbar,
  InboxBottomToolbarSpacer,
} from "@/components/inbox/inbox-bottom-toolbar"
import { InboxToolbar } from "@/components/inbox/inbox-toolbar"
import type { InboxState } from "@/lib/inbox/url-state"

const globalsCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")

const state: InboxState = {
  queue: "needs_reply",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
}

function renderToolbar(
  overrides: Partial<Parameters<typeof InboxToolbar>[0]> = {}
) {
  return render(
    <InboxToolbar
      state={state}
      counts={undefined}
      countsPending
      locations={[]}
      showLocationFilter={false}
      resultLabel="7 reviews"
      onFilterChange={vi.fn()}
      onQueueChange={vi.fn()}
      onClear={vi.fn()}
      {...overrides}
    />
  )
}

function bar() {
  return document.querySelector<HTMLElement>(
    '[data-slot="inbox-bottom-toolbar"]'
  )!
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("InboxBottomToolbar (R10, INB-19)", () => {
  it("draws the floating bar on the chrome contract's slot, one control row tall, where float-bar holds", () => {
    render(
      <InboxBottomToolbar searchMode={false}>
        <p>toolbar</p>
      </InboxBottomToolbar>
    )
    expect(bar()).toHaveClass(
      "max-md:flex",
      "float-bar:z-chrome",
      "float-bar:h-(--np-actionbar-h)",
      "float-bar:border-t",
      "float-bar:bg-surface"
    )
    // In the band (a short phone) it is only a row: no bar of its own.
    expect(bar().className).not.toMatch(/max-md:(?:z-|border-t|bg-|h-)/)
    expect(within(bar()).getByText("toolbar")).toBeInTheDocument()
  })

  it("shows the trailing control beside the toolbar on a phone only, and not in search", () => {
    const { rerender } = render(
      <InboxBottomToolbar searchMode={false} trailing={<button>Sync</button>}>
        <p>toolbar</p>
      </InboxBottomToolbar>
    )
    const trailing = bar().querySelector(
      '[data-slot="inbox-bottom-toolbar-trailing"]'
    )
    expect(trailing).toHaveClass("md:hidden", "empty:hidden")
    expect(within(trailing as HTMLElement).getByText("Sync")).toBeVisible()

    rerender(
      <InboxBottomToolbar searchMode trailing={<button>Sync</button>}>
        <p>toolbar</p>
      </InboxBottomToolbar>
    )
    // Hidden, not unmounted, so a running sync keeps its pending state.
    expect(trailing).toBeInTheDocument()
    expect(trailing).toHaveAttribute("hidden")
    expect(screen.getByText("Sync")).not.toBeVisible()
  })

  it("has a spacer that is hidden from assistive tech and shown only where the bar floats", () => {
    render(<InboxBottomToolbarSpacer />)
    const spacer = document.querySelector(
      '[data-slot="inbox-bottom-toolbar-spacer"]'
    )
    expect(spacer).toHaveAttribute("aria-hidden", "true")
    expect(spacer).toHaveClass(
      "hidden",
      "h-(--np-actionbar-h)",
      "float-bar:block"
    )
  })
})

describe("InboxToolbar with the bottom toolbar", () => {
  it("puts the search and the Filters button in the bottom toolbar", () => {
    renderToolbar()
    expect(
      within(bar()).getByRole("searchbox", { name: "Search reviews" })
    ).toBeInTheDocument()
    expect(
      within(bar()).getByRole("button", { name: /^Filters/ })
    ).toBeInTheDocument()
    // The queue strip stays in the band above the list.
    expect(
      within(bar()).queryByRole("navigation", { name: "Review queues" })
    ).toBeNull()
  })

  it("keeps the toolbar's row on one line on a phone, the field giving way first", () => {
    renderToolbar()
    const toolbar = bar().querySelector('[data-slot="toolbar"]')
    expect(toolbar).toHaveClass(
      "max-md:[&_[data-slot=toolbar-row]]:flex-nowrap",
      "max-md:[&_[data-slot=toolbar-search]]:basis-32"
    )
  })

  it("draws sync twice, once for each width: in the header from md, in the bottom toolbar below it", () => {
    renderToolbar({ sync: <button>Sync reviews</button> })
    const inBar = within(bar()).getByRole("button", { name: "Sync reviews" })
    expect(
      inBar.closest('[data-slot="inbox-bottom-toolbar-trailing"]')
    ).toHaveClass("md:hidden")
    const inHeader = within(
      document.querySelector<HTMLElement>('[data-slot="inbox-title-row"]')!
    ).getByRole("button", { name: "Sync reviews" })
    expect(inHeader.parentElement).toHaveClass("max-md:hidden")
  })

  it("draws no sync wrapper in the header when there is no sync control", () => {
    renderToolbar()
    expect(
      document.querySelector('[data-slot="inbox-title-row"] .max-md\\:hidden')
    ).toBeNull()
    expect(
      document.querySelector('[data-slot="inbox-bottom-toolbar-trailing"]')
    ).toBeNull()
  })

  it("takes the whole bar for search on a phone: sync steps aside, Cancel appears", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }))
    )
    const user = userEvent.setup()
    renderToolbar({ sync: <button>Sync reviews</button> })
    await user.click(screen.getByRole("searchbox", { name: "Search reviews" }))
    expect(
      within(bar()).getByRole("button", { name: "Cancel" })
    ).toBeInTheDocument()
    // Sync steps aside but stays mounted, keeping any running sync's state.
    expect(
      document.querySelector('[data-slot="inbox-bottom-toolbar-trailing"]')
    ).toHaveAttribute("hidden")
    expect(
      within(bar()).queryByRole("button", { name: "Sync reviews" })
    ).toBeNull()
  })
})

describe("the chrome contract for the Inbox's bottom toolbar", () => {
  it("fixes the bar above the tab bar on a phone with room, and on the keyboard at any height", () => {
    expect(globalsCss).toMatch(
      /@media \(width < 48rem\) and \(min-height: 40rem\) \{\s*\[data-slot="inbox-bottom-toolbar"\]\s*\{\s*position: fixed;[^}]*bottom: calc\(var\(--np-tabbar-h\) \+ var\(--np-safe-bottom\)\)/
    )
    expect(globalsCss).toMatch(
      /html\[data-keyboard="open"\] \[data-slot="inbox-bottom-toolbar"\]\s*\{\s*position: fixed;[^}]*bottom: var\(--np-dock-bottom\)/
    )
  })

  it("defines float-bar as the same three conditions", () => {
    expect(globalsCss).toMatch(
      /@custom-variant float-bar \{\s*@media \(width < 48rem\) and \(min-height: 40rem\) \{\s*@slot;\s*\}\s*@media \(width < 48rem\) \{\s*&:where\(\s*\[data-keyboard="open"\] \*,\s*:root:has\(\[data-slot="inbox-bottom-toolbar"\] input:focus\) \*\s*\) \{\s*@slot;/
    )
  })

  it("keeps the bar floating on the tab bar at any height while its search field has focus", () => {
    expect(globalsCss).toMatch(
      /html:has\(\[data-slot="inbox-bottom-toolbar"\] input:focus\):not\(\s*\[data-keyboard="open"\]\s*\) \{\s*& \[data-slot="inbox-bottom-toolbar"\] \{\s*position: fixed;[^}]*bottom: calc\(var\(--np-tabbar-h\) \+ var\(--np-safe-bottom\)\)/
    )
  })

  it("steps aside, with its spacer, for a docked bar: one bottom bar at a time", () => {
    expect(globalsCss).toMatch(
      /body:has\(\[data-docked="bottom"\]\) \[data-slot="inbox-bottom-toolbar"\],\s*body:has\(\[data-docked="bottom"\]\) \[data-slot="inbox-bottom-toolbar-spacer"\]\s*\{\s*display: none/
    )
  })

  it("counts the bar in the scroll padding only while the list is on screen", () => {
    expect(globalsCss).toContain(
      '[data-slot="inbox"][data-view="list"] [data-slot="inbox-bottom-toolbar"]'
    )
  })
})
