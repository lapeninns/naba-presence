import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ApiClientError } from "@/lib/api/client"
import {
  QueryError,
  QueryStates,
  queryStatus,
  RouteErrorState,
} from "@/components/ui/query-states"

describe("queryStatus", () => {
  it("orders pending > error > empty > ready", () => {
    expect(queryStatus({ isPending: true, isError: false })).toBe("pending")
    expect(queryStatus({ isPending: false, isError: true }, { isEmpty: true })).toBe("error")
    expect(queryStatus({ isPending: false, isError: false }, { isEmpty: true })).toBe("empty")
    expect(queryStatus({ isPending: false, isError: false })).toBe("ready")
  })
})

describe("QueryStates", () => {
  it("renders the default busy skeleton while pending", () => {
    const { container } = render(
      <QueryStates status="pending" error="Failed">
        ready
      </QueryStates>
    )
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull()
    expect(screen.queryByText("ready")).not.toBeInTheDocument()
  })

  it("renders a role=alert retry alert with copy from the merged error module", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(
      <QueryStates
        status="error"
        error={{
          title: "We could not load your reviews.",
          cause: new ApiClientError(401, "http_error", "x"),
        }}
        onRetry={onRetry}
      >
        ready
      </QueryStates>
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveTextContent("We could not load your reviews.")
    expect(alert).toHaveTextContent("Your session has expired. Sign in again to continue.")
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it("accepts a string title and a custom element for the error state", () => {
    const { rerender } = render(<QueryStates status="error" error="Boom" />)
    expect(screen.getByRole("alert")).toHaveTextContent("Boom")
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong. Please try again.")
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument()

    rerender(<QueryStates status="error" error={<p>custom chrome</p>} />)
    expect(screen.getByText("custom chrome")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("renders empty when given, and lazy children when ready", () => {
    const children = vi.fn(() => <p>rows</p>)
    const { rerender } = render(
      <QueryStates status="empty" error="Failed" empty={<p>nothing yet</p>}>
        {children}
      </QueryStates>
    )
    expect(screen.getByText("nothing yet")).toBeInTheDocument()
    expect(children).not.toHaveBeenCalled()

    rerender(
      <QueryStates status="ready" error="Failed" empty={<p>nothing yet</p>}>
        {children}
      </QueryStates>
    )
    expect(screen.getByText("rows")).toBeInTheDocument()
    expect(children).toHaveBeenCalledTimes(1)
  })
})

describe("QueryError", () => {
  it("describes a network failure and keeps an explicit description verbatim", () => {
    const { rerender } = render(
      <QueryError title="We couldn’t load this section" cause={new TypeError("Failed to fetch")} />
    )
    expect(screen.getByRole("alert")).toHaveTextContent("Check your connection")
    rerender(<QueryError title="Nope" description="Custom words." />)
    expect(screen.getByRole("alert")).toHaveTextContent("Custom words.")
  })
})

describe("RouteErrorState", () => {
  it("announces the failure and offers reset plus a way home", async () => {
    const user = userEvent.setup()
    const onReset = vi.fn()
    render(
      <RouteErrorState title="This page hit an error" description="Still working." onReset={onReset} />
    )
    expect(screen.getByRole("alert")).toHaveTextContent("This page hit an error")
    expect(screen.getByRole("link", { name: "Go to Inbox" })).toHaveAttribute("href", "/inbox")
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
