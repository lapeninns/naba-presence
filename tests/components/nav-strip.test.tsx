import { fireEvent, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ComponentProps } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// An anchor that records what each tab asked next/link to prefetch, so the
// TabNav `prefetch` modes can be read off the DOM. Everything else a tab
// renders (href, aria-current, classes) passes through unchanged.
vi.mock("next/link", () => ({
  default: ({
    href,
    prefetch,
    children,
    ...rest
  }: ComponentProps<"a"> & { prefetch?: boolean | "auto" | null }) => (
    <a
      href={href}
      data-prefetch={prefetch === undefined ? "default" : String(prefetch)}
      {...rest}
    >
      {children}
    </a>
  ),
}))

import {
  ChipCount,
  ChipRow,
  FilterChip,
  FilterChipStrip,
} from "@/components/ui/chip"
import { isZeroCount } from "@/components/ui/count-text"
import {
  TabCount,
  TabNav,
  TabsList,
  TabsTab,
  Tabs,
  tabItemClassName,
  textTabItemClassName,
} from "@/components/ui/tabs"
import { mediaQuery } from "@/lib/ui/breakpoints"

/*
 * Navigation-strip primitives (P04): the desk "More" overflow, the 44px tab
 * floor, the one zero rule and `hideWhenZero`. jsdom lays nothing out, so
 * the row and the hidden measuring copy of the tabs are given sizes here:
 * every tab is 100px wide, the "More" trigger 60px, the gap 4px.
 */

const TAB_WIDTH = 100
const MORE_WIDTH = 60
const GAP = 4

let rowWidth = 1000
let desk = true
const rectOf = (left: number, width: number) =>
  ({
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 40,
    height: 40,
    x: left,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect

const realRect = Element.prototype.getBoundingClientRect
const realMatchMedia = window.matchMedia

beforeEach(() => {
  desk = true
  rowWidth = 1000
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const cell = this.closest("[data-slot=tab-nav-measure] > ul > li")
    if (cell && cell.parentElement) {
      const index = Array.from(cell.parentElement.children).indexOf(cell)
      const last = index === cell.parentElement.children.length - 1
      return last
        ? rectOf(index * (TAB_WIDTH + GAP), MORE_WIDTH)
        : rectOf(index * (TAB_WIDTH + GAP), TAB_WIDTH)
    }
    // The visible row is the one list under the nav that is not the copy.
    if (
      this.tagName === "UL" &&
      this.closest("nav") &&
      !this.closest("[data-slot=tab-nav-measure]")
    )
      return rectOf(0, rowWidth)
    return rectOf(0, 0)
  }
  window.matchMedia = ((query: string) => ({
    matches: desk && query === mediaQuery("desk"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  Element.prototype.getBoundingClientRect = realRect
  window.matchMedia = realMatchMedia
})

const NAMES = ["Alpha", "Beta", "Gamma", "Delta", "Echo", "Foxtrot"]
const areas = (current: string) =>
  NAMES.map((label) => ({
    href: `/areas/${label.toLowerCase()}`,
    label,
    current: label === current,
  }))

function renderNav(current: string, width: number) {
  rowWidth = width
  return render(
    <TabNav aria-label="Areas" items={areas(current)} overflow="more" />
  )
}

const nav = () => screen.getByRole("navigation", { name: "Areas" })
const rowLinks = () => within(nav()).queryAllByRole("link")

describe("TabNav desk overflow", () => {
  it("draws every tab and no More menu when they all fit", () => {
    renderNav("Alpha", 1000)
    expect(rowLinks().map((link) => link.textContent)).toEqual(NAMES)
    expect(within(nav()).queryByRole("button")).not.toBeInTheDocument()
  })

  it("moves the tabs that do not fit into More, in order", async () => {
    const user = userEvent.setup()
    // Room for the trigger (60) and three tabs (3 x 100 + 2 x 4) in 450px.
    renderNav("Alpha", 450)
    expect(rowLinks().map((link) => link.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Gamma",
    ])
    const more = within(nav()).getByRole("button", { name: "More" })
    // The current tab is in the row, so the trigger is not current.
    expect(more).not.toHaveAttribute("aria-current")
    await user.click(more)
    const items = await screen.findAllByRole("menuitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Delta",
      "Echo",
      "Foxtrot",
    ])
    expect(items[0]).toHaveAttribute("href", "/areas/delta")
  })

  it("keeps the current tab in the row, in its own place, when it would not fit", () => {
    renderNav("Foxtrot", 450)
    const links = rowLinks()
    // Foxtrot is held first; the others fill what is left, in order.
    expect(links.map((link) => link.textContent)).toEqual([
      "Alpha",
      "Beta",
      "Foxtrot",
    ])
    expect(screen.getByRole("link", { name: "Foxtrot" })).toHaveAttribute(
      "aria-current",
      "page"
    )
    expect(
      within(nav()).getByRole("button", { name: "More" })
    ).not.toHaveAttribute("aria-current")
  })

  it("draws More as the current tab when the current page can only be in the menu", async () => {
    const user = userEvent.setup()
    // No room even for one tab beside the trigger.
    renderNav("Foxtrot", 150)
    expect(rowLinks()).toHaveLength(0)
    const more = within(nav()).getByRole("button", {
      name: /^More, current page: Foxtrot$/,
    })
    expect(more).toHaveAttribute("aria-current", "page")
    await user.click(more)
    const current = await screen.findByRole("menuitem", { name: "Foxtrot" })
    expect(current).toHaveAttribute("aria-current", "page")
  })

  it("puts tabs back in the row when the room grows", () => {
    const { rerender } = renderNav("Alpha", 450)
    expect(rowLinks()).toHaveLength(3)
    rowWidth = 1000
    rerender(
      <TabNav aria-label="Areas" items={areas("Alpha")} overflow="more" />
    )
    expect(rowLinks()).toHaveLength(6)
    expect(within(nav()).queryByRole("button")).not.toBeInTheDocument()
  })

  it("scrolls, with no More menu, where there is no desk (a phone or tablet)", () => {
    desk = false
    renderNav("Alpha", 450)
    expect(rowLinks().map((link) => link.textContent)).toEqual(NAMES)
    expect(within(nav()).queryByRole("button")).not.toBeInTheDocument()
  })

  it("scrolls by default, even at a desk", () => {
    rowWidth = 450
    render(<TabNav aria-label="Areas" items={areas("Alpha")} />)
    expect(rowLinks()).toHaveLength(6)
    expect(within(nav()).queryByRole("button")).not.toBeInTheDocument()
  })

  it("keeps the measuring copy out of the accessibility tree", () => {
    renderNav("Alpha", 450)
    const copy = nav().querySelector("[data-slot=tab-nav-measure]")!
    expect(copy).toHaveAttribute("aria-hidden", "true")
    expect(copy).toHaveAttribute("inert")
  })

  it("has exactly one aria-current=page in the nav: the copy does not add a second", () => {
    renderNav("Alpha", 450)
    expect(nav().querySelectorAll('[aria-current="page"]')).toHaveLength(1)
    // The copy still measures the current tab at 600 weight, by attribute.
    const copy = nav().querySelector("[data-slot=tab-nav-measure]")!
    const current = copy.querySelectorAll("[data-current]")
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveTextContent("Alpha")
    expect(current[0]).toHaveClass("data-current:font-semibold")
  })

  it("measures the More trigger at the weight it is drawn when current", () => {
    renderNav("Alpha", 450)
    const copy = nav().querySelector("[data-slot=tab-nav-measure]")!
    const trigger = copy.querySelector("ul > li:last-child > span")!
    expect(trigger).toHaveTextContent("More")
    expect(trigger).toHaveClass("font-semibold")
    expect(trigger).not.toHaveClass("font-medium")
  })
})

describe("tab touch floor (MEA-03)", () => {
  it("gives every tab drawing a 44px minimum width on touch, released at a desk", () => {
    for (const cls of [tabItemClassName, textTabItemClassName]) {
      expect(cls).toContain("min-w-(--np-touch)")
      expect(cls).toContain("desk:min-w-0")
      expect(cls).toContain("justify-center")
    }
  })

  it("applies it to a tab link, a tablist tab and a short-label tab", () => {
    render(
      <>
        <TabNav
          aria-label="Short"
          items={[{ href: "/all", label: "All", current: true }]}
        />
        <Tabs defaultValue="a">
          <TabsList variant="text" aria-label="Notifications">
            <TabsTab value="a">All</TabsTab>
          </TabsList>
        </Tabs>
      </>
    )
    expect(screen.getByRole("link", { name: "All" })).toHaveClass(
      "min-w-(--np-touch)"
    )
    // The /notifications tabs are this one: TabsList variant="text".
    expect(screen.getByRole("tab", { name: "All" })).toHaveClass(
      "min-w-(--np-touch)"
    )
  })
})

describe("the zero rule (INB-11)", () => {
  it("knows a zero by number or by its formatted text", () => {
    expect(isZeroCount(0)).toBe(true)
    expect(isZeroCount("0")).toBe(true)
    expect(isZeroCount(" 0 ")).toBe(true)
    expect(isZeroCount(3)).toBe(false)
    expect(isZeroCount("10")).toBe(false)
    expect(isZeroCount("–")).toBe(false)
    expect(isZeroCount(null)).toBe(false)
  })

  it("draws no figure for a zero tab or chip count", () => {
    const { container } = render(
      <>
        <TabCount>{0}</TabCount>
        <TabCount>0</TabCount>
        <ChipCount>{0}</ChipCount>
        <ChipCount>0</ChipCount>
      </>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("still draws a real count", () => {
    render(
      <>
        <TabCount>12</TabCount>
        <ChipCount>4</ChipCount>
      </>
    )
    expect(screen.getByText("12")).toHaveAttribute("data-slot", "tab-count")
    expect(screen.getByText("4")).toHaveAttribute("data-slot", "chip-count")
  })

  it("draws a TabNav item with a zero count as its label alone", () => {
    render(
      <TabNav
        aria-label="Queues"
        items={[
          { href: "/a", label: "Approval", count: 0 },
          { href: "/b", label: "Failed", count: "0" },
          { href: "/c", label: "Needs reply", count: 12 },
        ]}
      />
    )
    expect(screen.getByRole("link", { name: "Approval" })).toHaveTextContent(
      /^Approval$/
    )
    expect(screen.getByRole("link", { name: "Failed" })).toHaveTextContent(
      /^Failed$/
    )
    expect(
      screen.getByRole("link", { name: "Needs reply 12" })
    ).toBeInTheDocument()
    expect(screen.queryByText("–")).not.toBeInTheDocument()
  })

  it("draws a FilterChip with a zero count as its label alone", () => {
    render(<FilterChip count={0}>Not linked</FilterChip>)
    const chip = screen.getByRole("button", { name: "Not linked, 0" })
    expect(chip).toHaveTextContent(/^Not linked$/)
    expect(chip.querySelector('[data-slot="chip-count"]')).toBeNull()
  })

  it("keeps the zero in a chip's accessible name, which contains the visible label", () => {
    render(
      <>
        <FilterChip count={0}>In sync</FilterChip>
        <FilterChip count={0} aria-label="Nothing to publish">
          To publish
        </FilterChip>
        <FilterChip count={4}>Needs attention</FilterChip>
      </>
    )
    expect(
      screen.getByRole("button", { name: "In sync, 0" })
    ).toBeInTheDocument()
    // A caller's own name wins.
    expect(
      screen.getByRole("button", { name: "Nothing to publish" })
    ).toBeInTheDocument()
    // A real count reads from the text, as before.
    expect(
      screen.getByRole("button", { name: "Needs attention 4" })
    ).toBeInTheDocument()
  })

  it("draws the chip's count through ChipCount, in the chip's own ink", () => {
    render(
      <FilterChip pressed count={3}>
        Needs reply
      </FilterChip>
    )
    const figure = screen.getByText("3")
    expect(figure).toHaveAttribute("data-slot", "chip-count")
    expect(figure).toHaveClass("text-count", "tabular-nums")
    expect(figure.className).not.toMatch(/text-ink|text-danger/)
  })
})

describe("FilterChip hideWhenZero", () => {
  it("hides an empty chip", () => {
    const { container } = render(
      <FilterChip count={0} hideWhenZero>
        Not linked
      </FilterChip>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("hides a chip whose formatted count is '0'", () => {
    const { container } = render(
      <FilterChip count="0" hideWhenZero>
        Not linked
      </FilterChip>
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("shows an empty chip that is pressed, with no figure", () => {
    render(
      <FilterChip count={0} hideWhenZero pressed>
        Not linked
      </FilterChip>
    )
    const chip = screen.getByRole("button", { name: "Not linked, 0" })
    expect(chip).toHaveAttribute("aria-pressed", "true")
    expect(chip.querySelector('[data-slot="chip-count"]')).toBeNull()
  })

  it("shows an empty applied filter", () => {
    render(
      <FilterChip count={0} hideWhenZero onRemove={() => {}}>
        Not linked
      </FilterChip>
    )
    expect(
      screen.getByRole("button", { name: "Remove filter: Not linked" })
    ).toBeInTheDocument()
  })

  it("shows a chip with something in it", () => {
    render(
      <FilterChip count={3} hideWhenZero>
        Needs attention
      </FilterChip>
    )
    expect(
      screen.getByRole("button", { name: "Needs attention 3" })
    ).toBeInTheDocument()
  })

  it("is opt-in: an empty chip stays without it, and one without a count is never hidden", () => {
    render(
      <>
        <FilterChip count={0}>In sync</FilterChip>
        <FilterChip hideWhenZero>All</FilterChip>
      </>
    )
    expect(
      screen.getByRole("button", { name: "In sync, 0" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument()
  })
})

describe("chip rows keep the 44px hit area", () => {
  // The 28px chip's touch extension reaches 8px above and below it. A row
  // that scrolls sideways clips vertically (overflow-x-auto), so its padding
  // must be at least that 8px (py-2) or the target shrinks to 40px. The
  // negative margin gives the space back so the row keeps its height.
  it("pads ChipRow by the extension's 8px, undone by a matching negative margin", () => {
    render(
      <ChipRow data-testid="row">
        <FilterChip>All</FilterChip>
      </ChipRow>
    )
    const row = screen.getByTestId("row")
    expect(row).toHaveClass("overflow-x-auto", "py-2", "-my-2")
    expect(row.className).not.toMatch(/\bpy-1\.5\b/)
  })

  it("keeps the padding in FilterChipStrip, where a caller's classes are merged in", () => {
    render(
      <FilterChipStrip data-testid="strip" className="-mx-5 px-5">
        <FilterChip>All</FilterChip>
      </FilterChipStrip>
    )
    expect(screen.getByTestId("strip")).toHaveClass("py-2", "-my-2")
  })

  it("draws the chip's extension at the touch floor", () => {
    render(<FilterChip>All</FilterChip>)
    expect(screen.getByRole("button", { name: "All" })).toHaveClass(
      "after:inset-y-[calc((100%-var(--np-touch))/2)]",
      "desk:after:hidden"
    )
  })
})

describe("the pressed filter chip", () => {
  it("has cues beyond the tint: 600 weight and an accent-ink edge", () => {
    render(<FilterChip pressed>Needs reply</FilterChip>)
    const chip = screen.getByRole("button", { name: "Needs reply" })
    expect(chip).toHaveClass(
      "bg-accent-tint",
      "font-semibold",
      "ring-1",
      "ring-inset",
      "ring-accent-ink"
    )
    expect(chip.className).not.toMatch(/\bbg-ink\b/)
  })

  it("leaves an unpressed chip without the edge", () => {
    render(<FilterChip>Needs reply</FilterChip>)
    const chip = screen.getByRole("button", { name: "Needs reply" })
    expect(chip).not.toHaveClass("ring-1")
    expect(chip).not.toHaveClass("font-semibold")
  })
})

describe("TabNav prefetch (L16)", () => {
  const renderStrip = (prefetch?: "viewport" | "intent") =>
    render(
      <TabNav
        aria-label="Areas"
        items={areas("Alpha").slice(0, 3)}
        prefetch={prefetch}
      />
    )
  const link = (name: string) =>
    within(nav()).getByRole("link", { name: new RegExp(`^${name}`) })

  it("keeps next/link's viewport prefetch by default", () => {
    renderStrip()
    for (const name of ["Alpha", "Beta", "Gamma"])
      expect(link(name)).toHaveAttribute("data-prefetch", "default")
  })

  it("prefetches nothing on mount with intent", () => {
    renderStrip("intent")
    for (const name of ["Alpha", "Beta", "Gamma"])
      expect(link(name)).toHaveAttribute("data-prefetch", "false")
  })

  it("prefetches a tab on focus, and only that tab", () => {
    renderStrip("intent")
    fireEvent.focus(link("Beta"))
    expect(link("Beta")).toHaveAttribute("data-prefetch", "auto")
    expect(link("Alpha")).toHaveAttribute("data-prefetch", "false")
    expect(link("Gamma")).toHaveAttribute("data-prefetch", "false")
  })

  it("prefetches a tab on pointer-enter, and only that tab", () => {
    renderStrip("intent")
    fireEvent.pointerEnter(link("Gamma"))
    expect(link("Gamma")).toHaveAttribute("data-prefetch", "auto")
    expect(link("Alpha")).toHaveAttribute("data-prefetch", "false")
    expect(link("Beta")).toHaveAttribute("data-prefetch", "false")
  })
})
