import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { act, render, renderHook, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ListHeader } from "@/components/inbox/list-header"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import type { ReviewRow } from "@/lib/contracts/reviews"

vi.mock("@/components/inbox/google-freshness", () => ({
  GoogleFreshness: () => null,
}))

function row(id: string): ReviewRow {
  return { id } as ReviewRow
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
      </SelectionProvider>
    </QueryClientProvider>
  )
}

const readout = () => screen.getByTestId("readout").textContent

afterEach(() => {
  vi.restoreAllMocks()
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

  it("lines the box up with the rows' 44px column and leaves the target to the Checkbox", () => {
    const { container } = renderHeader()
    const column = container.querySelector<HTMLElement>(
      "[data-slot=inbox-select-all]"
    )!
    expect(column).toHaveClass("w-11")
    // No local <label> wrapper: the primitive's own 44px touch hit area
    // (selectionHitAreaClassName) is the target.
    expect(column.tagName).toBe("SPAN")
    const box = screen.getByRole("checkbox", {
      name: "Select every review in this view",
    })
    expect(box.className).toContain(
      "after:inset-[calc((18px-var(--np-touch))/2)]"
    )
  })

  it("toggles select mode with Select and Done", async () => {
    const user = userEvent.setup()
    renderHeader()
    await user.click(screen.getByRole("button", { name: "Select" }))
    expect(readout()).toBe("none · on")
    await user.click(
      screen.getByRole("checkbox", { name: "Select every review in this view" })
    )
    // Done ends the mode and drops what was ticked.
    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(readout()).toBe("none · off")
    expect(screen.getByRole("button", { name: "Select" })).toBeInTheDocument()
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
