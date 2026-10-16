import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReviewRow } from "@/lib/contracts/reviews"

// The bar's code: how many times it was asked for, and whether it downloads.
const chunk = vi.hoisted(() => ({ requested: 0, fails: true }))
vi.mock("@/components/inbox/bulk-action-bar", () => {
  chunk.requested += 1
  return {
    get BulkActionBar() {
      if (chunk.fails) {
        const error = new Error("Loading chunk 31 failed.")
        error.name = "ChunkLoadError"
        throw error
      }
      return function BulkActionBar({ rows }: { rows: ReviewRow[] }) {
        return (
          <div role="region" aria-label="Selected reviews">
            The real bar for {rows.length} reviews
          </div>
        )
      }
    },
  }
})

const rows = [{ id: "a" }, { id: "b" }] as ReviewRow[]

/** What the route's error boundary would show, in place of the Inbox. */
class RouteBoundary extends React.Component<
  { children: React.ReactNode },
  { hit: boolean }
> {
  state = { hit: false }
  static getDerivedStateFromError() {
    return { hit: true }
  }
  render() {
    return this.state.hit ? (
      <p>The route error boundary replaced the Inbox</p>
    ) : (
      this.props.children
    )
  }
}

/**
 * The bar keeps its lazy component at module level (as the app does), so each
 * test gets the modules afresh rather than inheriting a load that succeeded.
 */
async function renderInbox() {
  vi.resetModules()
  const { LazyBulkActionBar } =
    await import("@/components/inbox/lazy-bulk-action-bar")
  const { SelectionProvider, useSelection } =
    await import("@/components/inbox/selection-context")
  const { Toaster } = await import("@/components/ui/toast")
  function Inbox() {
    const selection = useSelection()
    return (
      <section>
        <p>the review list</p>
        <p>the open review</p>
        <p data-testid="ticks">{[...selection.selected].sort().join(",")}</p>
        <button type="button" onClick={() => selection.toggle("a")}>
          tick a
        </button>
        <button type="button" onClick={() => selection.clear()}>
          untick all
        </button>
        <LazyBulkActionBar rows={rows} />
      </section>
    )
  }
  return render(
    <Toaster>
      <RouteBoundary>
        <SelectionProvider>
          <Inbox />
        </SelectionProvider>
      </RouteBoundary>
    </Toaster>
  )
}

beforeEach(() => {
  chunk.requested = 0
  chunk.fails = true
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("LazyBulkActionBar", () => {
  it("draws nothing and asks for nothing while nothing is selected", async () => {
    const { unmount } = await renderInbox()
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100))
    })
    expect(chunk.requested).toBe(0)
    expect(
      screen.queryByRole("region", {
        name: /Selected reviews|Selection actions/,
      })
    ).not.toBeInTheDocument()
    unmount()
  })

  it("keeps the Inbox, says so, and offers Try again when the bar will not load", async () => {
    const user = userEvent.setup()
    await renderInbox()
    await user.click(screen.getByRole("button", { name: "tick a" }))

    expect(
      await screen.findByText("Could not open the selection actions")
    ).toBeInTheDocument()
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selection actions could not load."
    )
    const retry = screen.getByRole("button", { name: "Try again" })
    expect(retry).toBeVisible()
    // The route's boundary was not reached: the list, the open review and
    // the selection are all as they were.
    expect(screen.queryByText(/route error boundary/)).not.toBeInTheDocument()
    expect(screen.getByText("the review list")).toBeInTheDocument()
    expect(screen.getByText("the open review")).toBeInTheDocument()
    expect(screen.getByTestId("ticks")).toHaveTextContent("a")

    // The connection is back: Try again asks afresh (a failed load stays
    // failed for the component that saw it) and the real bar appears.
    chunk.fails = false
    await user.click(retry)
    expect(
      await screen.findByRole("region", { name: "Selected reviews" })
    ).toHaveTextContent("The real bar for 2 reviews")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(screen.getByTestId("ticks")).toHaveTextContent("a")
  })

  it("drops the notice when the selection is emptied and tries again on the next one", async () => {
    const user = userEvent.setup()
    await renderInbox()
    await user.click(screen.getByRole("button", { name: "tick a" }))
    expect(await screen.findByRole("alert")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "untick all" }))
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Try again" })
    ).not.toBeInTheDocument()

    chunk.fails = false
    await user.click(screen.getByRole("button", { name: "tick a" }))
    expect(
      await screen.findByRole("region", { name: "Selected reviews" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })
})
