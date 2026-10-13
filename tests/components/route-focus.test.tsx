import { act, render, screen, waitFor } from "@testing-library/react"
import type * as React from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

const pathname = vi.hoisted(() => ({ current: "/inbox" }))
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }))

import { RouteFocus } from "@/components/app-shell/route-focus"

// WCAG 2.4.3: after a client-side navigation focus lands on the new page's
// h1, so a keyboard or screen-reader user starts at the page they opened.

afterEach(() => {
  vi.useRealTimers()
  pathname.current = "/inbox"
})

function Shell({
  children,
  title = "Inbox",
}: {
  children?: React.ReactNode
  title?: string | null
}) {
  return (
    <div>
      <nav data-slot="tab-bar" aria-label="Primary">
        <button type="button">Listings</button>
      </nav>
      <button type="button">Elsewhere</button>
      <main id="main" tabIndex={-1}>
        {title ? <h1>{title}</h1> : null}
        <input aria-label="Search reviews" />
        {children}
      </main>
      <RouteFocus />
    </div>
  )
}

function navigate(
  rerender: (ui: React.ReactElement) => void,
  to: string,
  ui: React.ReactElement
) {
  pathname.current = to
  act(() => rerender(ui))
}

describe("RouteFocus", () => {
  it("leaves focus alone on the first load", () => {
    render(<Shell />)
    expect(document.body).toHaveFocus()
  })

  it("moves focus to the new page's h1 after the path changes", () => {
    const { rerender } = render(<Shell />)
    navigate(rerender, "/listings", <Shell title="Listings" />)
    const heading = screen.getByRole("heading", { level: 1, name: "Listings" })
    expect(heading).toHaveFocus()
    // Made focusable by script only, without a visible ring.
    expect(heading).toHaveAttribute("tabindex", "-1")
  })

  it("moves focus off the tab that started the navigation", () => {
    const { rerender } = render(<Shell />)
    screen.getByRole("button", { name: "Listings" }).focus()
    navigate(rerender, "/listings", <Shell title="Listings" />)
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
  })

  it("ignores a change that leaves the path the same (a query-string change)", () => {
    const { rerender } = render(<Shell />)
    // The Inbox keeps its filters in the query string; the path is unchanged.
    act(() => rerender(<Shell />))
    expect(document.body).toHaveFocus()
  })

  it("never takes focus from something inside the page", () => {
    const { rerender } = render(<Shell />)
    const field = screen.getByRole("textbox", { name: "Search reviews" })
    field.focus()
    navigate(rerender, "/listings", <Shell title="Listings" />)
    expect(field).toHaveFocus()
  })

  it("never takes focus from something the shell's chrome does not own", () => {
    const { rerender } = render(<Shell />)
    const other = screen.getByRole("button", { name: "Elsewhere" })
    other.focus()
    navigate(rerender, "/listings", <Shell title="Listings" />)
    expect(other).toHaveFocus()
  })

  it("waits for a streaming page's h1", async () => {
    const { rerender } = render(<Shell />)
    navigate(rerender, "/listings", <Shell title={null} />)
    expect(document.body).toHaveFocus()
    act(() => rerender(<Shell title="Listings" />))
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    )
  })

  it("settles for #main when no h1 arrives", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    const { rerender } = render(<Shell />)
    navigate(rerender, "/listings", <Shell title={null} />)
    expect(document.body).toHaveFocus()
    act(() => {
      vi.advanceTimersByTime(3000)
    })
    expect(screen.getByRole("main")).toHaveFocus()
  })
})
