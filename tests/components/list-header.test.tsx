import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ListHeader } from "@/components/inbox/list-header"
import { selectionHitAreaClassName } from "@/components/ui/checkbox"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import type { ReviewRow } from "@/lib/contracts/reviews"
import { mediaQuery } from "@/lib/ui/breakpoints"

vi.mock("@/components/inbox/google-freshness", () => ({
  GoogleFreshness: ({ className }: { className?: string }) => (
    <span data-testid="freshness" className={className}>
      Google checked 5 min ago
    </span>
  ),
}))

function row(id: string): ReviewRow {
  return { id } as ReviewRow
}

/** A pointer and width that reach (or do not reach) the desk breakpoint. */
function stubDesk(desk: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: desk && query === mediaQuery("desk"),
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
}

/** Ticks and clears the way the rows and Escape do. */
function Controls() {
  const { toggle, clear } = useSelection()
  return (
    <>
      <button type="button" onClick={() => toggle("a")}>
        tick a
      </button>
      <button type="button" onClick={() => clear()}>
        escape
      </button>
    </>
  )
}

/** Shows what the selection holds, so a test can read it back. */
function Readout() {
  const { selected, selectMode } = useSelection()
  return (
    <div data-testid="readout">
      {[...selected].sort().join(",") || "none"} · {selectMode ? "on" : "off"}
    </div>
  )
}

function renderHeader(
  props: Partial<React.ComponentProps<typeof ListHeader>> = {}
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <SelectionProvider>
        <ListHeader
          canBatch
          reviews={[row("a"), row("b")]}
          loaded
          countLabel="2 reviews"
          countAnnouncement="2 reviews"
          refreshed="14:32"
          {...props}
        />
        <Readout />
        <Controls />
      </SelectionProvider>
    </QueryClientProvider>
  )
}

const readout = () => screen.getByTestId("readout").textContent

// Touch unless a test says otherwise: select mode is a touch tool.
beforeEach(() => stubDesk(false))

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("freshness", () => {
  it("shows when Google was last checked at every width, phones included", () => {
    renderHeader()
    const freshness = screen.getByTestId("freshness")
    // It used to be `max-2xl:hidden`, so a phone, and a member or viewer
    // with no Sync button, could not tell how fresh the list was.
    expect(freshness.className).not.toMatch(/hidden/)
    expect(freshness).toHaveClass("min-w-0", "truncate")
  })

  it("steps aside for the selection count on a phone", async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole("button", { name: "Select" }))
    expect(screen.getByTestId("freshness")).toHaveClass("max-desk:hidden")
  })
})

describe("selection mode", () => {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SelectionProvider>{children}</SelectionProvider>
  )

  it("turns on when a row is ticked", () => {
    const { result } = renderHook(() => useSelection(), { wrapper })
    expect(result.current.selectMode).toBe(false)
    act(() => result.current.toggle("a"))
    expect(result.current.selectMode).toBe(true)
    expect([...result.current.selected]).toEqual(["a"])
  })

  it("stays on when a row is unticked or the selection is cleared", () => {
    const { result } = renderHook(() => useSelection(), { wrapper })
    act(() => result.current.toggle("a"))
    act(() => result.current.toggle("a"))
    expect(result.current.selectMode).toBe(true)
    act(() => result.current.toggle("b"))
    act(() => result.current.clear())
    expect(result.current.selected.size).toBe(0)
    expect(result.current.selectMode).toBe(true)
  })

  it("clears the selection when it is turned off", () => {
    const { result } = renderHook(() => useSelection(), { wrapper })
    act(() => result.current.replace(["a", "b"]))
    act(() => result.current.setSelectMode(false))
    expect(result.current.selected.size).toBe(0)
    expect(result.current.selectMode).toBe(false)
  })

  it("keeps the selection when it is turned on", () => {
    const { result } = renderHook(() => useSelection(), { wrapper })
    act(() => result.current.replace(["a"]))
    act(() => result.current.setSelectMode(true))
    expect([...result.current.selected]).toEqual(["a"])
  })
})

describe("ListHeader", () => {
  it("shows the count and announces it politely", () => {
    renderHeader({
      countLabel: "50 reviews so far",
      countAnnouncement: "2 reviews",
    })
    expect(screen.getByText("50 reviews so far")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("2 reviews")
  })

  it("says when the list was refreshed in words, not a tooltip", () => {
    renderHeader()
    const refreshed = screen.getByText(/Refreshed 14:32/)
    expect(refreshed).not.toHaveAttribute("title")
    expect(refreshed).toHaveTextContent(/from NabaPresence/)
  })

  it("holds the refreshed time's place, hidden, until the viewer's clock is known", () => {
    renderHeader({ refreshed: null })
    const placeholder = screen.getByText(/Refreshed 00:00/)
    expect(placeholder).toHaveClass("invisible")
    expect(placeholder).toHaveAttribute("aria-hidden", "true")
  })

  it("selects every loaded review and clears them again", async () => {
    const user = userEvent.setup()
    renderHeader()
    const all = screen.getByRole("checkbox", {
      name: "Select every review in this view",
    })
    await user.click(all)
    expect(readout()).toBe("a,b · off")
    await user.click(all)
    expect(readout()).toBe("none · off")
  })

  it("lines the box up with the rows' leading column and leaves the target to the Checkbox", () => {
    const { container } = renderHeader()
    const column = container.querySelector<HTMLElement>(
      "[data-slot=inbox-select-all]"
    )!
    // ListRow's leading column, where the rows' tick boxes sit.
    expect(column).toHaveClass("size-(--np-avatar-list)")
    expect(column.className).not.toMatch(/-ml-|w-11/)
    // No local <label> wrapper: the primitive's own 44px touch hit area
    // (selectionHitAreaClassName) is the target.
    expect(column.tagName).toBe("SPAN")
    const box = screen.getByRole("checkbox", {
      name: "Select every review in this view",
    })
    expect(box).toHaveClass(...selectionHitAreaClassName.split(" "))
  })

  it("toggles select mode with Select and Cancel", async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole("button", { name: "Select" }))
    expect(readout()).toBe("none · on")
    await user.click(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    )
    // Cancel ends the mode and drops what was ticked.
    const cancel = screen.getByRole("button", { name: "Cancel selection" })
    // The visible word is part of the name (WCAG 2.5.3).
    expect(cancel).toHaveTextContent("Cancel")
    await user.click(cancel)
    expect(readout()).toBe("none · off")
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument()
  })

  it("reads '0 selected' in select mode, then the ticked count, beside the one Cancel", async () => {
    const user = userEvent.setup()
    const { container } = renderHeader()
    expect(
      container.querySelector("[data-slot=inbox-selected-count]")
    ).toBeNull()
    await user.click(screen.getByRole("button", { name: "Select" }))
    const selected = container.querySelector<HTMLElement>(
      "[data-slot=inbox-selected-count]"
    )!
    expect(selected).toHaveTextContent("0 selected")
    // The selection's count replaces the list's count while it lasts.
    expect(
      screen.queryByText("2 reviews", { selector: "span:not([role=status])" })
    ).toBeNull()
    await user.click(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    )
    // The header owns the count and the Cancel: the selection bar below
    // holds only the actions, so there is one of each.
    expect(
      container.querySelector("[data-slot=inbox-selected-count]")
    ).toHaveTextContent("2 selected")
    expect(screen.getAllByRole("button", { name: /cancel/i })).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Cancel selection" })
    ).toBeVisible()
    // The count is also spoken, from a region that is always mounted.
    expect(screen.getByText("2 reviews selected")).toHaveAttribute(
      "aria-live",
      "polite"
    )
  })

  it("offers Cancel on a desk once something is ticked, without select mode", async () => {
    stubDesk(true)
    const user = userEvent.setup()
    const { container } = renderHeader()
    // A desk's boxes are always there: no Select button, no Cancel to start.
    const select = screen.getByRole("button", { name: "Select" })
    expect(select).toHaveClass("desk:hidden")
    await user.click(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    )
    expect(readout()).toBe("a,b · off")
    const cancel = screen.getByRole("button", { name: "Cancel selection" })
    // Not folded away on a desk any more: it is the way out of the ticks.
    expect(cancel).not.toHaveClass("desk:hidden")
    expect(
      container.querySelector("[data-slot=inbox-selected-count]")
    ).toHaveTextContent("2 selected")
    await user.click(cancel)
    expect(readout()).toBe("none · off")
    expect(
      container.querySelector("[data-slot=inbox-selected-count]")
    ).toBeNull()
    expect(screen.getByRole("button", { name: "Select" })).toHaveClass(
      "desk:hidden"
    )
  })

  it("returns a desk's header to normal when the last tick goes (Escape or unticking)", async () => {
    stubDesk(true)
    const user = userEvent.setup()
    const { container } = renderHeader()
    const count = () =>
      container.querySelector("[data-slot=inbox-selected-count]")
    // Ticking a row sets select mode in the context, so a desk's band must
    // not read "0 selected · Cancel" once the ticks are gone.
    await user.click(screen.getByRole("button", { name: "tick a" }))
    expect(count()).toHaveTextContent("1 selected")
    await user.click(screen.getByRole("button", { name: "escape" }))
    expect(count()).toBeNull()
    expect(
      screen.getByText("2 reviews", { selector: "span:not([role=status])" })
    ).toBeInTheDocument()
    // The leftover mode is dropped with it.
    expect(readout()).toBe("none · off")
    expect(screen.getByRole("button", { name: "Select" })).toHaveClass(
      "desk:hidden"
    )

    // The same by unticking the one row.
    await user.click(screen.getByRole("button", { name: "tick a" }))
    expect(count()).toHaveTextContent("1 selected")
    await user.click(screen.getByRole("button", { name: "tick a" }))
    expect(count()).toBeNull()
    expect(readout()).toBe("none · off")
  })

  it("keeps touch select mode, '0 selected' and all, when the last tick goes", async () => {
    const user = userEvent.setup()
    const { container } = renderHeader()
    await user.click(screen.getByRole("button", { name: "Select" }))
    await user.click(screen.getByRole("button", { name: "tick a" }))
    await user.click(screen.getByRole("button", { name: "escape" }))
    // The operator chose this mode; Escape empties the set and leaves it.
    expect(
      container.querySelector("[data-slot=inbox-selected-count]")
    ).toHaveTextContent("0 selected")
    expect(readout()).toBe("none · on")
    expect(
      screen.getByRole("button", { name: "Cancel selection" })
    ).toBeVisible()
  })

  it("hands keyboard focus to Select when Cancel ends touch select mode", async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole("button", { name: "Select" }))
    await user.click(screen.getByRole("button", { name: "Cancel selection" }))
    // Not left on a control that has just left the page.
    expect(screen.getByRole("button", { name: "Select" })).toHaveFocus()
  })

  it("hands keyboard focus to the select-all box when Cancel ends a desk selection", async () => {
    stubDesk(true)
    const user = userEvent.setup()
    renderHeader()
    await user.click(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    )
    const cancel = screen.getByRole("button", { name: "Cancel selection" })
    cancel.focus()
    await user.keyboard("{Enter}")
    expect(readout()).toBe("none · off")
    // Cancel is folded away on a desk once nothing is ticked; focus does
    // not fall to <body> with it.
    expect(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    ).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })

  it("shows the select-all box on touch only in select mode", async () => {
    const user = userEvent.setup()
    const { container } = renderHeader()
    const box = container.querySelector("[data-slot=inbox-select-all]")
    expect(box).toHaveClass("hidden", "desk:flex")
    await user.click(screen.getByRole("button", { name: "Select" }))
    expect(box).toHaveClass("flex")
    expect(box).not.toHaveClass("hidden")
  })

  it("offers no select tools to someone who cannot batch", () => {
    renderHeader({ canBatch: false, countAnnouncement: "" })
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Select" })
    ).not.toBeInTheDocument()
    expect(screen.getByText("2 reviews")).toBeInTheDocument()
  })
})
