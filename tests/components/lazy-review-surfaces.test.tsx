import { cleanup, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import * as React from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// AMA-146: the profile's review sheets and the Inbox's open review load their
// code on demand. A failed download must leave the page working and the next
// attempt must ask for the code afresh (React caches a rejected lazy load).
const chunk = vi.hoisted(() => ({ requested: 0, fails: true }))
const failingExport = <T,>(make: () => T) => {
  chunk.requested += 1
  if (chunk.fails) {
    const error = new Error("Loading chunk 77 failed.")
    error.name = "ChunkLoadError"
    throw error
  }
  return make()
}

/** What the route's error boundary would show, in place of the page. */
class RouteBoundary extends React.Component<
  { children: React.ReactNode },
  { hit: boolean }
> {
  state = { hit: false }
  static getDerivedStateFromError() {
    return { hit: true }
  }
  render() {
    return this.state.hit ? <p>route boundary</p> : this.props.children
  }
}

beforeEach(() => {
  chunk.requested = 0
  chunk.fails = true
})
afterEach(() => {
  cleanup()
  vi.doUnmock("@/components/reviewed-write/combined-review")
  vi.doUnmock("@/components/inbox/review-pane")
})

describe("a lazy review sheet", () => {
  async function renderProfile() {
    vi.resetModules()
    vi.doMock("@/components/reviewed-write/combined-review", () => ({
      get CombinedReviewSheet() {
        return failingExport(
          () =>
            function CombinedReviewSheet({ open }: { open: boolean }) {
              return open ? <div role="dialog">the review sheet</div> : null
            }
        )
      },
    }))
    const { CombinedReviewSheet } =
      await import("@/components/reviewed-write/lazy-sheets")
    const { Toaster } = await import("@/components/ui/toast")
    function Profile() {
      const [open, setOpen] = React.useState(false)
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Review changes
          </button>
          <p data-testid="open">{String(open)}</p>
          <CombinedReviewSheet
            {...({} as React.ComponentProps<typeof CombinedReviewSheet>)}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      )
    }
    return render(
      <Toaster>
        <RouteBoundary>
          <Profile />
        </RouteBoundary>
      </Toaster>
    )
  }

  it("asks for nothing until it is first opened", async () => {
    await renderProfile()
    expect(chunk.requested).toBe(0)
    expect(screen.queryByText("the review sheet")).toBeNull()
  })

  it("closes with a toast when its code cannot load, and loads on the next open", async () => {
    const user = userEvent.setup()
    await renderProfile()
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    expect(await screen.findByText("Could not open the review")).toBeTruthy()
    expect(screen.getByTestId("open").textContent).toBe("false")
    expect(screen.queryByText("route boundary")).toBeNull()
    chunk.fails = false
    await user.click(screen.getByRole("button", { name: "Review changes" }))
    expect(await screen.findByText("the review sheet")).toBeTruthy()
  })
})

describe("the lazy review pane", () => {
  async function renderInbox() {
    vi.resetModules()
    vi.doMock("@/components/inbox/review-pane", () => ({
      get ReviewPane() {
        return failingExport(
          () =>
            function ReviewPane({ reviewId }: { reviewId: string }) {
              return <p>review {reviewId}</p>
            }
        )
      },
    }))
    const { LazyReviewPane, reloadReviewPane } =
      await import("@/components/inbox/lazy-review-pane")
    const { DetailErrorBoundary } =
      await import("@/components/inbox/detail-error-boundary")
    return render(
      <RouteBoundary>
        <p>the review list</p>
        <DetailErrorBoundary onBack={() => {}} onReset={reloadReviewPane}>
          <LazyReviewPane reviewId="r1" withActions />
        </DetailErrorBoundary>
      </RouteBoundary>
    )
  }

  it("keeps the list when its code cannot load, and Try again loads it afresh", async () => {
    const user = userEvent.setup()
    await renderInbox()
    expect(
      await screen.findByText("This review could not be shown.")
    ).toBeTruthy()
    expect(screen.getByText("the review list")).toBeTruthy()
    chunk.fails = false
    await user.click(screen.getByRole("button", { name: "Try again" }))
    await waitFor(() => expect(screen.getByText("review r1")).toBeTruthy())
  })
})
