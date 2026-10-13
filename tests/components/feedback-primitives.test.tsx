import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ActionBar, ActionBarMuted } from "@/components/ui/action-bar"
import { Button, DisabledReason, buttonVariants } from "@/components/ui/button"
import { Empty } from "@/components/ui/empty"
import { Kbd } from "@/components/ui/kbd"
import { LoadMore } from "@/components/ui/load-more"
import {
  OutcomeSummary,
  outcomeCounts,
  overallOutcome,
} from "@/components/ui/outcome-summary"
import { OperationOutcomeNotice } from "@/components/ui/operation-outcome"
import { QueryStates } from "@/components/ui/query-states"
import { TabNav, Tabs, TabsList, TabsTab } from "@/components/ui/tabs"
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
          { href: "/listings/a/menu", label: "Menu", current: true, disabled: true },
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
      "max-md:[body:has([data-docked=bottom])_&]:[--toast-edge:calc(var(--np-actionbar-h)+var(--np-dock-bottom))]"
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
  // prim-20: the notice and the steps used to disagree (clock vs hourglass).
  it("draws the same glyph in the notice and the summary", () => {
    const { container } = render(
      <>
        <OperationOutcomeNotice outcome="awaiting_confirmation" />
        <OutcomeSummary outcome="awaiting_confirmation" />
      </>
    )
    expect(container.querySelectorAll(".lucide-hourglass")).toHaveLength(2)
    expect(container.querySelector(".lucide-clock")).toBeNull()
  })
})

describe("OutcomeSummary", () => {
  it("derives the headline from the worst step and counts the rest", () => {
    const states = [
      "confirmed_applied",
      "failed",
      "confirmed_applied",
      "skipped",
    ] as const
    expect(overallOutcome(states)).toBe("failed")
    expect(overallOutcome(["pending", "skipped"])).toBeNull()
    expect(overallOutcome(["confirmed_applied"])).toBe("confirmed_applied")
    expect(outcomeCounts(states).map((c) => `${c.count} ${c.word}`)).toEqual([
      "1 Failed",
      "2 Live on Google",
      "1 Skipped",
    ])
  })

  it("announces the headline and lists the steps and next actions", () => {
    render(
      <OutcomeSummary
        steps={[
          { id: "a", label: "Sunday hours", state: "confirmed_applied" },
          { id: "b", label: "Holiday hours", state: "failed", errorCode: "E1" },
        ]}
        actions={<Button>Retry failed</Button>}
      />
    )
    expect(screen.getByRole("status")).toHaveTextContent(
      "The change didn’t go through"
    )
    expect(
      screen.getByRole("region", { name: "The change didn’t go through" })
    ).toHaveAttribute("data-outcome", "failed")
    expect(screen.getByRole("list", { name: "Results" })).toBeInTheDocument()
    expect(screen.getByText("Holiday hours")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Retry failed" })
    ).toBeInTheDocument()
  })

  it("never says Live on Google without a confirmed outcome", () => {
    render(<OutcomeSummary outcome="sent" />)
    expect(screen.queryByText(/Live on Google/)).not.toBeInTheDocument()
    expect(
      screen.getByRole("heading", { name: "Sent to Google" })
    ).toBeInTheDocument()
  })
})
