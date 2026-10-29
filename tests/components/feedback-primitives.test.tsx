import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button, DisabledReason, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { LoadMore } from "@/components/ui/load-more"
import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { QueryStates } from "@/components/ui/query-states"
import {
  TabNav,
  Tabs,
  TabsList,
  TabsPanel,
  TabsTab,
} from "@/components/ui/tabs"
import {
  ERROR_TOAST_TIMEOUT,
  ACTION_TOAST_TIMEOUT,
  Toaster,
  withToastDefaults,
} from "@/components/ui/toast"
import type { ListPaging } from "@/lib/queries/paged-list"

describe("buttonVariants", () => {
  // clients-reports-10: read without cn(), the base border-transparent and
  // the variant's border colour both reached the element.
  it("returns merged classes, safe to use without cn()", () => {
    const classes = buttonVariants({ variant: "secondary" }).split(" ")
    expect(classes).toContain("border-line-strong")
    expect(classes).not.toContain("border-transparent")
    expect(buttonVariants({ className: "h-12" }).split(" ")).not.toContain(
      "h-(--np-control-h)"
    )
  })

  it("sizes from the control tokens, with no per-pointer patches", () => {
    expect(buttonVariants({ size: "sm" })).toContain("h-(--np-control-h-sm)")
    expect(buttonVariants({ size: "icon-sm" })).toContain(
      "size-(--np-control-h-sm)"
    )
    for (const size of ["default", "sm", "icon", "icon-sm", "xs"] as const) {
      expect(buttonVariants({ size })).not.toMatch(/pointer-coarse:/)
    }
  })

  // Taste pilot P1: disabled is drawn with the disabled roles, never faded,
  // and a pending button (disabled but aria-busy) is excluded from it.
  const DISABLED = "drawn-disabled:"
  const variants = [
    "default",
    "tinted",
    "secondary",
    "outline",
    "ghost",
    "danger",
    "danger-outline",
    "destructive",
    "on-dark",
    "ghost-dark",
    "link",
  ] as const

  it("draws disabled with the disabled roles, never with opacity", () => {
    for (const variant of variants) {
      const classes = buttonVariants({ variant }).split(" ")
      expect(classes.some((c) => c.includes("opacity"))).toBe(false)
      if (variant === "ghost-dark") {
        expect(classes).toContain(`${DISABLED}text-ink-muted-on-charcoal`)
      } else {
        expect(classes).toContain(`${DISABLED}text-disabled-ink`)
      }
    }
    // Filled and outlined alike keep the quiet edge, so a disabled button
    // still reads as a control on surface-alt (the dialog footer), which is
    // the same step as bg-disabled in light mode.
    for (const drawn of [
      "default",
      "tinted",
      "danger",
      "on-dark",
      "secondary",
      "outline",
      "danger-outline",
      "destructive",
    ] as const) {
      const classes = buttonVariants({ variant: drawn }).split(" ")
      expect(classes).toContain(`${DISABLED}bg-disabled`)
      expect(classes).toContain(`${DISABLED}border-disabled-line`)
    }
    for (const bare of ["ghost", "link"] as const) {
      expect(buttonVariants({ variant: bare })).not.toContain(
        `${DISABLED}bg-disabled`
      )
    }
  })

  it("hovers only under a fine pointer, and never while disabled or pressed", () => {
    for (const variant of variants) {
      const classes = buttonVariants({ variant }).split(" ")
      // The hover-scoped transition is not a fill; disabled turns it off
      // through `drawn-disabled:transition-none` (tested below).
      const hovers = classes.filter(
        (c) => c.includes("hover:") && !c.includes(":transition-")
      )
      expect(hovers.length).toBeGreaterThan(0)
      for (const hover of hovers) {
        expect(hover).toMatch(
          /^hover-fine:hover:(not-active:)?not-data-disabled:not-aria-disabled:/
        )
      }
    }
  })

  it("presses one step stronger than hover, and moves only when motion is allowed", () => {
    const secondary = buttonVariants({ variant: "secondary" }).split(" ")
    expect(secondary).toContain(
      "hover-fine:hover:not-active:not-data-disabled:not-aria-disabled:bg-fill-secondary"
    )
    expect(secondary).toContain(
      "active:not-data-disabled:not-aria-disabled:bg-fill"
    )
    // Ghost has no fill at rest, so it draws relative to the surface under
    // it: a ladder step would match the surface-alt dialog footer.
    const ghost = buttonVariants({ variant: "ghost" }).split(" ")
    expect(ghost).toContain(
      "hover-fine:hover:not-active:not-data-disabled:not-aria-disabled:bg-ink/6"
    )
    expect(ghost).toContain(
      "active:not-data-disabled:not-aria-disabled:bg-ink/10"
    )
    expect(ghost.some((c) => /bg-fill(-secondary)?$/.test(c))).toBe(false)
    const base = buttonVariants().split(" ")
    expect(base).toContain(
      "motion-safe:active:not-disabled:not-data-disabled:not-aria-disabled:translate-y-px"
    )
    expect(base.some((c) => c.startsWith("active:translate"))).toBe(false)
    // The link's cancel merges the base offset away instead of fighting it.
    const link = buttonVariants({ variant: "link" }).split(" ")
    expect(link.filter((c) => c.endsWith("translate-y-px"))).toHaveLength(0)
  })

  it("eases colour only as pointer feedback, so enabling or disabling switches at once", () => {
    // A Send button enabled by a ticked consent must never be read (by a
    // person or an axe sample) half-way between disabled grey and green.
    const base = buttonVariants().split(" ")
    const eased =
      "transition-[background-color,border-color,color,box-shadow,transform]"
    expect(base).toContain("transition-none")
    expect(base).toContain(`hover-fine:hover:${eased}`)
    expect(base).toContain(`active:${eased}`)
    expect(base).toContain("drawn-disabled:transition-none")
    expect(base).not.toContain(eased)
  })
})

describe("Button disabled and pending", () => {
  it("marks a disabled button for the drawn disabled state", () => {
    render(<Button disabledReason="Connect Google first">Publish</Button>)
    const button = screen.getByRole("button", { name: "Publish" })
    expect(button).toHaveAttribute("data-disabled")
    expect(button).not.toHaveAttribute("aria-busy")
    expect(
      button.matches(
        ":is(:disabled,[data-disabled],[aria-disabled=true]):not([aria-busy=true])"
      )
    ).toBe(true)
  })

  it("keeps a pending button out of the disabled drawing", () => {
    render(
      <Button pending pendingLabel="Publishing…">
        Publish
      </Button>
    )
    const button = screen.getByRole("button", { name: "Publishing…" })
    expect(button).toHaveAttribute("aria-busy", "true")
    expect(
      button.matches(
        ":is(:disabled,[data-disabled],[aria-disabled=true]):not([aria-busy=true])"
      )
    ).toBe(false)
    expect(button.className).toContain("aria-busy:cursor-progress")
  })
})

describe("Button iconOnlyBelow", () => {
  it("keeps the visible label as the accessible name", () => {
    render(
      <Button iconOnlyBelow="md">
        <svg aria-hidden />
        Refresh
      </Button>
    )
    const button = screen.getByRole("button", { name: "Refresh" })
    expect(button.className).toContain("max-md:size-(--np-control-h)")
    expect(
      button.querySelector('[data-slot="button-label"]')
    ).toHaveTextContent("Refresh")
  })
})

describe("DisabledReason", () => {
  it("shows the reason beside the control without reading it twice", () => {
    render(
      <DisabledReason reason="Connect Google first">
        <Button disabledReason="Connect Google first">Publish</Button>
      </DisabledReason>
    )
    const button = screen.getByRole("button", { name: "Publish" })
    expect(button).toHaveAccessibleDescription("Connect Google first")
    const visible = screen
      .getAllByText("Connect Google first")
      .find((node) => !node.hidden)
    expect(visible).toHaveAttribute("aria-hidden", "true")
  })
})

describe("ActionBar", () => {
  it("rests a sticky, undocked bar on top of the phone tab bar", () => {
    const { container, rerender } = render(<ActionBar>Saved</ActionBar>)
    const lift = "data-slot=tab-bar"
    expect(
      container.querySelector('[data-slot="action-bar"]')?.className
    ).toContain(lift)
    // A docked bar hides the tab bar instead, so it never takes the lift.
    rerender(<ActionBar dock>Saved</ActionBar>)
    expect(
      container.querySelector('[data-slot="action-bar"]')?.className
    ).not.toContain(lift)
  })

  const slots = (container: HTMLElement) =>
    container.ownerDocument.querySelectorAll('[data-slot="action-bar"]')

  // tests/e2e/verification-pin-backend.spec.ts counts exactly one.
  it("renders exactly one action-bar slot, docked or not", () => {
    const { container, rerender } = render(
      <ActionBar status="Saved" actions={<Button>Save</Button>} />
    )
    expect(slots(container)).toHaveLength(1)
    rerender(
      <ActionBar
        dock
        status="1 change"
        primary={<Button>Publish</Button>}
        secondaryActions={[{ label: "Discard", onClick: () => {} }]}
      />
    )
    expect(slots(container)).toHaveLength(1)
    // The spacer reserves the bar's whole docked height (action bar plus
    // the dock edge), the same sum the chrome contract's scroll padding
    // uses, so the page's last line is never under the bar.
    expect(
      container.querySelector('[data-slot="action-bar-spacer"]')?.className
    ).toContain("var(--np-actionbar-h)+var(--np-dock-bottom)")
  })

  it("publishes a docked bar's measured height for the spacer and scroll padding", () => {
    // A bar that wraps to two rows (the editor footer, a blocked setup
    // step) is taller than --np-actionbar-h: the spacer, the document's
    // scroll padding and the toast edge read the measured height instead.
    const root = document.documentElement
    let height = 64
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        return {
          top: 0,
          left: 0,
          right: 390,
          bottom: height,
          width: 390,
          height,
        } as DOMRect
      })
    const styles = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => ({ position: "fixed" }) as CSSStyleDeclaration)
    let onResize = () => {}
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback
        }
        observe() {}
        disconnect() {}
      }
    )
    try {
      const { container, unmount } = render(
        <ActionBar dock status="1 change" primary={<Button>Save</Button>} />
      )
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("64px")
      expect(
        container.querySelector('[data-slot="action-bar-spacer"]')?.className
      ).toContain("var(--np-dock-bar-h,")
      height = 116
      act(() => onResize())
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("116px")
      unmount()
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("")
    } finally {
      spy.mockRestore()
      styles.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it("leaves no node at all while not visible", () => {
    const { container, rerender } = render(
      <ActionBar dock visible={false} primary={<Button>Save</Button>} />
    )
    expect(slots(container)).toHaveLength(0)
    expect(
      container.querySelector('[data-slot="action-bar-spacer"]')
    ).toBeNull()
    expect(container).toBeEmptyDOMElement()
    rerender(<ActionBar dock visible primary={<Button>Save</Button>} />)
    expect(slots(container)).toHaveLength(1)
  })

  it("declares itself to the chrome contract only when docked", () => {
    const { rerender } = render(<ActionBar label="Editor actions" />)
    const region = () => screen.getByRole("region", { name: "Editor actions" })
    expect(region()).not.toHaveAttribute("data-docked")
    rerender(<ActionBar dock label="Editor actions" />)
    expect(region()).toHaveAttribute("data-docked", "bottom")
    expect(region().className).toContain("max-md:fixed")
    expect(region().className).toContain(
      "max-md:pb-[max(--spacing(2),var(--np-dock-bottom))]"
    )
    expect(region().className).toContain("z-chrome")
    expect(region().className).not.toMatch(/\bz-20\b|\bz-50\b/)
  })

  it("draws charcoal by default and the light surface on request", () => {
    const { rerender } = render(
      <ActionBar status={<ActionBarMuted>muted</ActionBarMuted>} />
    )
    expect(screen.getByRole("region")).toHaveAttribute(
      "data-bar-tone",
      "charcoal"
    )
    expect(screen.getByRole("region").className).toContain("on-charcoal")
    rerender(
      <ActionBar
        tone="surface"
        status={<ActionBarMuted>muted</ActionBarMuted>}
      />
    )
    expect(screen.getByRole("region").className).not.toContain("on-charcoal")
    expect(screen.getByText("muted").className).toContain(
      "in-data-[bar-tone=surface]:text-ink-muted"
    )
  })

  it("puts secondaries inline from md and in one overflow menu on a phone", async () => {
    const user = userEvent.setup()
    const discard = vi.fn()
    render(
      <ActionBar
        dock
        primary={<Button>Publish</Button>}
        secondaryActions={[
          { label: "Discard", onClick: discard, destructive: true },
          { label: "Preview", disabledReason: "Nothing to preview" },
        ]}
      />
    )
    const inline = screen.getByRole("button", { name: "Discard" })
    expect(inline.className).toContain("max-md:hidden")
    const more = screen.getByRole("button", { name: "More actions" })
    expect(more.className).toContain("md:hidden")
    // The primary is last, under the right thumb.
    const actions = screen
      .getByRole("region")
      .querySelector('[data-slot="action-bar-actions"]') as HTMLElement
    const buttons = within(actions).getAllByRole("button")
    expect(buttons.at(-1)).toHaveAccessibleName("Publish")

    await user.click(more)
    const item = await screen.findByRole("menuitem", { name: "Discard" })
    await user.click(item)
    expect(discard).toHaveBeenCalledTimes(1)
  })
})

describe("TabNav", () => {
  const items = [
    { href: "/settings", label: "Policy" },
    { href: "/settings/connections", label: "Google connections" },
    {
      href: "/settings/privacy",
      label: "Data and privacy",
      disabled: true,
      unavailableReason: "Owners only",
    },
    { href: "/settings/billing", label: "Billing", current: true },
  ]

  // listings-content-07: a disabled area is not navigable and not a tab stop.
  it("renders a disabled item as a non-interactive, aria-disabled link", async () => {
    const user = userEvent.setup()
    render(<TabNav aria-label="Settings sections" items={items} />)
    const disabled = screen.getByRole("link", { name: /Data and privacy/ })
    expect(disabled).toHaveAttribute("aria-disabled", "true")
    expect(disabled).not.toHaveAttribute("href")
    expect(disabled).not.toHaveAttribute("aria-current")
    expect(disabled).toHaveTextContent(/unavailable: Owners only/)
    // Tab moves past it.
    await user.tab()
    await user.tab()
    await user.tab()
    expect(document.activeElement).toHaveAccessibleName("Billing")
  })

  it("keeps a disabled item that is the current page as the current link", () => {
    render(
      <TabNav
        aria-label="Listing areas"
        items={[
          { href: "/listings/a", label: "Overview" },
          {
            href: "/listings/a/menu",
            label: "Menu",
            current: true,
            disabled: true,
          },
        ]}
      />
    )
    const current = screen.getByRole("link", { name: "Menu" })
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current).toHaveAttribute("href", "/listings/a/menu")
    expect(current).not.toHaveAttribute("aria-disabled")
  })

  it("keeps aria-current on the active link", () => {
    render(<TabNav aria-label="Settings sections" items={items} />)
    expect(screen.getByRole("link", { name: "Billing" })).toHaveAttribute(
      "aria-current",
      "page"
    )
  })

  // prim-04 / settings-setup-auth-02: the current tab is scrolled into its
  // row on mount and on change, along the row only.
  it("scrolls the current tab into view on mount and when it changes", () => {
    const rect = (left: number, width: number) =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 44,
        height: 44,
      }) as DOMRect
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === "UL") return rect(0, 300)
        // Laid out in a row that scrolls: a tab's box moves left as the
        // row scrolls right.
        const index = Number(this.closest("li")?.dataset.index ?? 0)
        const scrolled = this.closest("ul")?.scrollLeft ?? 0
        return rect(index * 150 - scrolled, 140)
      })
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.tagName === "UL" ? 300 : 140
      },
    })
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return this.tagName === "UL" ? 600 : 140
      },
    })
    try {
      const at = (href: string) =>
        items.map((item) => ({ ...item, current: item.href === href }))
      const { container, rerender } = render(
        <TabNav aria-label="Sections" items={at("/settings")} />
      )
      container
        .querySelectorAll("li")
        .forEach((li, index) => (li.dataset.index = String(index)))
      rerender(<TabNav aria-label="Sections" items={at("/settings/billing")} />)
      const row = container.querySelector("ul") as HTMLUListElement
      // Billing is the 4th item (450-590): centred in the 300px row, then
      // clamped to the 300px of scroll there is.
      expect(row.scrollLeft).toBe(300)
      rerender(<TabNav aria-label="Sections" items={at("/settings")} />)
      expect(row.scrollLeft).toBe(0)
    } finally {
      spy.mockRestore()
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
    }
  })

  it("brings the current tab back into view when the row resizes after mount", () => {
    // A late font, a count arriving or the shell settling can narrow the row
    // after mount; the current tab that fitted must be revealed again.
    let rowWidth = 600
    const rect = (left: number, width: number) =>
      ({
        left,
        width,
        right: left + width,
        top: 0,
        bottom: 44,
        height: 44,
      }) as DOMRect
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        if (this.tagName === "UL") return rect(0, rowWidth)
        const index = Number(this.closest("li")?.dataset.index ?? 0)
        const scrolled = this.closest("ul")?.scrollLeft ?? 0
        return rect(index * 150 - scrolled, 140)
      })
    Object.defineProperty(HTMLElement.prototype, "clientWidth", {
      configurable: true,
      get() {
        return this.tagName === "UL" ? rowWidth : 140
      },
    })
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get() {
        return this.tagName === "UL" ? 600 : 140
      },
    })
    const observed: Element[] = []
    let onResize = () => {}
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback
        }
        observe(target: Element) {
          observed.push(target)
        }
        disconnect() {}
      }
    )
    try {
      const at = (href: string) =>
        items.map((item) => ({ ...item, current: item.href === href }))
      const { container, rerender } = render(
        <TabNav aria-label="Sections" items={at("/settings")} />
      )
      container
        .querySelectorAll("li")
        .forEach((li, index) => (li.dataset.index = String(index)))
      // Billing (450-590) fits the 600px row: nothing scrolls.
      rerender(<TabNav aria-label="Sections" items={at("/settings/billing")} />)
      const row = container.querySelector("ul") as HTMLUListElement
      expect(row.scrollLeft).toBe(0)
      expect(observed).toContain(row)
      // The row narrows to 300px: Billing is out of view until revealed.
      rowWidth = 300
      act(() => onResize())
      expect(row.scrollLeft).toBe(300)
    } finally {
      spy.mockRestore()
      vi.unstubAllGlobals()
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth
    }
  })

  it("shows a short label on a phone without changing the accessible name", () => {
    render(
      <TabNav
        aria-label="Reports"
        items={[
          {
            href: "/reports/replies",
            label: "Reply performance",
            shortLabel: "Replies",
            current: true,
          },
        ]}
      />
    )
    const link = screen.getByRole("link")
    expect(within(link).getByText("Replies").className).toContain("sm:hidden")
    expect(within(link).getByText("Reply performance").className).toContain(
      "max-sm:hidden"
    )
  })

  it("is 44px on touch and 40px under desk", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTab value="a">A</TabsTab>
        </TabsList>
      </Tabs>
    )
    const tab = screen.getByRole("tab", { name: "A" })
    expect(tab.className).toContain("h-11")
    expect(tab.className).toContain("desk:h-10")
    expect(tab.className).not.toContain("pointer-coarse")
  })

  it("shows where focus is when its panel is the Tab stop (WCAG 2.4.7)", () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTab value="a">A</TabsTab>
        </TabsList>
        <TabsPanel value="a">Panel A</TabsPanel>
      </Tabs>
    )
    const panel = screen.getByRole("tabpanel")
    // Base UI makes the panel focusable; it must draw a focus indicator,
    // inside its box so a clipping parent cannot hide it.
    expect(panel).toHaveAttribute("tabindex", "0")
    expect(panel).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-inset",
      "focus-visible:ring-(--np-focus-ring)",
      "forced-colors:focus-ring-inset"
    )
  })
})

describe("Toast", () => {
  it("docks the stack to the bottom, above whichever bar owns the edge", () => {
    render(<Toaster>app</Toaster>)
    const viewport = document.querySelector(
      '[data-slot="toast-viewport"]'
    ) as HTMLElement
    expect(viewport.className).toContain("bottom-(--toast-bottom)")
    expect(viewport.className).not.toMatch(/(^|\s)top-/)
    expect(viewport.className).toContain("z-toast")
    expect(viewport.className).toContain(
      "max-md:[body:has([data-docked=bottom])_&]:[--toast-edge:var(--np-dock-bar-h,calc(var(--np-actionbar-h)+var(--np-dock-bottom)))]"
    )
    expect(viewport.className).toContain("data-slot=tab-bar")
  })

  it("keeps errors up longer, and an action toast longer still unless told", () => {
    expect(withToastDefaults({ title: "Saved" }).timeout).toBeUndefined()
    expect(withToastDefaults({ title: "Failed", type: "error" }).timeout).toBe(
      ERROR_TOAST_TIMEOUT
    )
    expect(
      withToastDefaults({ title: "Failed", type: "error", timeout: 3000 })
        .timeout
    ).toBe(3000)
    expect(
      withToastDefaults({ title: "Removed", actionProps: { children: "Undo" } })
        .timeout
    ).toBe(ACTION_TOAST_TIMEOUT)
  })
})

describe("Empty", () => {
  it.each([
    ["empty", null],
    ["error", "lucide-circle-alert"],
    ["forbidden", "lucide-lock"],
    ["offline", "lucide-wifi-off"],
    ["not-enabled", "lucide-power-off"],
  ] as const)("draws the %s variant with its glyph", (variant, glyph) => {
    const { container } = render(<Empty variant={variant} title="Title" />)
    const root = container.querySelector('[data-slot="empty"]') as HTMLElement
    expect(root).toHaveAttribute("data-variant", variant)
    if (glyph) expect(root.querySelector(`.${glyph}`)).not.toBeNull()
    else expect(root.querySelector("svg")).toBeNull()
  })

  it("keeps the original tone API and adds the framed card and an action", () => {
    const { container } = render(
      <Empty
        tone="ok"
        framed
        title="Nothing needs a reply"
        action={<Button>Open inbox</Button>}
      />
    )
    const root = container.querySelector('[data-slot="empty"]') as HTMLElement
    expect(root).toHaveAttribute("data-tone", "ok")
    expect(root.className).toContain("border-line")
    expect(
      screen.getByRole("button", { name: "Open inbox" })
    ).toBeInTheDocument()
  })

  it("is what QueryStates renders for an error, announced with a retry", () => {
    render(
      <QueryStates status="error" error="Couldn't load" onRetry={() => {}} />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveAttribute("data-slot", "empty")
    expect(alert).toHaveAttribute("data-variant", "error")
    expect(
      within(alert).getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
  })
})

describe("LoadMore", () => {
  const paging = (overrides: Partial<ListPaging> = {}) =>
    ({
      hasMore: true,
      loadingMore: false,
      loadMoreFailed: false,
      loadMore: vi.fn(),
      ...overrides,
    }) as ListPaging

  it("never invents a total it does not know", () => {
    render(<LoadMore shown={40} noun={["photo", "photos"]} paging={paging()} />)
    expect(screen.getByRole("status")).toHaveTextContent("Showing 40 photos")
    expect(screen.getByRole("status")).not.toHaveTextContent(/of/)
  })

  it("keeps the known-total words and a full-size button", () => {
    render(
      <LoadMore
        shown={20}
        total={45}
        noun={["photo", "photos"]}
        paging={paging()}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "Showing 20 of 45 photos"
    )
    const button = screen.getByRole("button", { name: "Load more photos" })
    expect(button).toHaveAttribute("data-size", "default")
  })
})

describe("Kbd", () => {
  it("is hidden on touch and shown under desk, unless told to show", () => {
    const { rerender } = render(<Kbd>K</Kbd>)
    expect(screen.getByText("K").className).toContain("hidden desk:inline-flex")
    rerender(<Kbd touch="show">K</Kbd>)
    expect(screen.getByText("K").className).not.toContain("hidden")
  })
})

describe("outcome glyphs", () => {
  // prim-20: awaiting confirmation used to be drawn with a clock, not the hourglass.
  it("draws awaiting confirmation with the hourglass in the notice", () => {
    const { container } = render(
      <OperationOutcomeNotice outcome="awaiting_confirmation" />
    )
    expect(container.querySelectorAll(".lucide-hourglass")).toHaveLength(1)
    expect(container.querySelector(".lucide-clock")).toBeNull()
  })
})
