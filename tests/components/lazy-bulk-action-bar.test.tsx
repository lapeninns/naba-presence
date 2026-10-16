import { act, cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ReviewRow } from "@/lib/contracts/reviews"

// The bar's code: how many times it was asked for, and whether it downloads.
const chunk = vi.hoisted(() => ({ requested: 0, mounted: 0, fails: true }))
const barModule = () => {
  chunk.requested += 1
  return {
    get BulkActionBar() {
      if (chunk.fails) {
        const error = new Error("Loading chunk 31 failed.")
        error.name = "ChunkLoadError"
        throw error
      }
      return function BulkActionBar({ rows }: { rows: ReviewRow[] }) {
        chunk.mounted += 1
        return (
          <div role="region" aria-label="Selected reviews">
            The real bar for {rows.length} reviews
          </div>
        )
      }
    },
  }
}

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
  // Registered afresh each time: a factory registered once is run once, which
  // would hide every request for the code after the first.
  vi.doMock("@/components/inbox/bulk-action-bar", barModule)
  const { LazyBulkActionBar } =
    await import("@/components/inbox/lazy-bulk-action-bar")
  const { SelectionProvider, useSelection } =
    await import("@/components/inbox/selection-context")
  const { Toaster } = await import("@/components/ui/toast")
  function Inbox() {
    const selection = useSelection()
    return (
      <section>
        {/* The list header's one way out, which outlives the bar's notice. */}
        <div data-slot="inbox-list-header">
          <button type="button" aria-label="Cancel selection">
            Cancel
          </button>
        </div>
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
  chunk.mounted = 0
  chunk.fails = true
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("LazyBulkActionBar", () => {
  describe("with nothing selected", () => {
    /** The browser's idle callbacks, held so a test decides when they run. */
    function holdIdleCallbacks() {
      const pending: Array<() => void> = []
      Object.defineProperty(window, "requestIdleCallback", {
        configurable: true,
        value: (callback: () => void) => pending.push(callback),
      })
      Object.defineProperty(window, "cancelIdleCallback", {
        configurable: true,
        value: () => {},
      })
      return pending
    }
    afterEach(() => {
      // After the tree is gone, which cancels the idle callback it asked for.
      cleanup()
      Reflect.deleteProperty(window, "requestIdleCallback")
      Reflect.deleteProperty(window, "cancelIdleCallback")
      vi.useRealTimers()
    })

    it("draws nothing and does not need the code", async () => {
      const idle = holdIdleCallbacks()
      await renderInbox()
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
      })
      // Before the browser's idle time, nothing has asked for the code.
      expect(idle).toHaveLength(1)
      expect(chunk.requested).toBe(0)
      expect(
        screen.queryByRole("region", {
          name: /Selected reviews|Selection actions/,
        })
      ).not.toBeInTheDocument()
    })

    it("fetches the code in idle time without drawing the bar", async () => {
      const idle = holdIdleCallbacks()
      await renderInbox()
      await act(async () => {
        idle[0]()
        await new Promise((resolve) => setTimeout(resolve, 50))
      })
      // The idle callback only warms the cache: the module was requested, but
      // the bar was never mounted (its export was not even read).
      expect(chunk.requested).toBe(1)
      expect(chunk.mounted).toBe(0)
      expect(
        screen.queryByRole("region", { name: "Selected reviews" })
      ).not.toBeInTheDocument()
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    })

    it("falls back to a timer where there is no idle callback, and still only preloads", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
      await renderInbox()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1999)
      })
      expect(chunk.requested).toBe(0)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1)
      })
      expect(chunk.requested).toBe(1)
      expect(chunk.mounted).toBe(0)
      expect(
        screen.queryByRole("region", { name: "Selected reviews" })
      ).not.toBeInTheDocument()
    })
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

  it("keeps focus on the page when Try again succeeds, parked on the header's Cancel", async () => {
    const user = userEvent.setup()
    await renderInbox()
    await user.click(screen.getByRole("button", { name: "tick a" }))
    const retry = await screen.findByRole("button", { name: "Try again" })

    chunk.fails = false
    await user.click(retry)
    expect(
      await screen.findByRole("region", { name: "Selected reviews" })
    ).toBeInTheDocument()
    // The notice that had focus is gone: focus is on a control that stays,
    // not on the body.
    expect(
      screen.getByRole("button", { name: "Cancel selection" })
    ).toHaveFocus()
    expect(document.body).not.toHaveFocus()
  })

  it("puts focus back on the new Try again when the retry fails again", async () => {
    const user = userEvent.setup()
    await renderInbox()
    await user.click(screen.getByRole("button", { name: "tick a" }))
    await user.click(await screen.findByRole("button", { name: "Try again" }))

    // Still offline: a new notice, and focus is on its button.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus()
    )
    expect(screen.getByRole("alert")).toHaveTextContent(
      "The selection actions could not load."
    )
  })

  it("leaves focus alone when the operator has moved on before the retry fails", async () => {
    const user = userEvent.setup()
    await renderInbox()
    await user.click(screen.getByRole("button", { name: "tick a" }))
    await user.click(await screen.findByRole("button", { name: "Try again" }))
    // Focus went to the header's Cancel; the operator then goes to a button
    // of their own before the notice returns.
    screen.getByRole("button", { name: "untick all" }).focus()
    await screen.findByRole("alert")
    expect(screen.getByRole("button", { name: "untick all" })).toHaveFocus()
  })
})
