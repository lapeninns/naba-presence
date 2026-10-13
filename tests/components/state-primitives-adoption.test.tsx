import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TabError, TabLoading } from "@/components/locations/tab-states"
import { ReportingPanel } from "@/components/reporting/reporting-states"
import { ApiClientError } from "@/lib/api/client"

afterEach(cleanup)

// Reports and the per-location tabs draw their loading / error / empty
// states with the shared primitives (components/ui/empty.tsx and
// query-states.tsx), keeping their own copy, retries and heading levels.
describe("ReportingPanel on the shared state primitives", () => {
  it("loads as QueryPending: a named status over the row placeholders", () => {
    const { container } = render(
      <ReportingPanel variant="loading" title="Loading keywords…" />
    )
    expect(screen.getByRole("status")).toHaveTextContent("Loading keywords…")
    expect(
      container.querySelector('[data-slot="skeleton-list"]')
    ).toBeInTheDocument()
  })

  it("fails as the Empty error state, announced, with its copy and retry", () => {
    const onRetry = vi.fn()
    const { container } = render(
      <ReportingPanel variant="error" onRetry={onRetry} />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveAttribute("data-slot", "empty")
    expect(alert).toHaveAttribute("data-variant", "error")
    expect(alert).toHaveTextContent("We could not load this report")
    expect(alert).toHaveTextContent(
      "The reporting service didn’t answer, so nothing is shown rather than a guess. Nothing was changed."
    )
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()
    // Never a bare line on the page: the failure stands on its own card.
    expect(container.querySelector('[data-slot="empty"]')?.className).toMatch(
      /border/
    )
  })

  it("offers no retry when there is nothing to retry", () => {
    render(<ReportingPanel variant="error" />)
    expect(screen.getByRole("alert")).toBeInTheDocument()
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("keeps an empty panel's heading level", () => {
    render(<ReportingPanel framed titleAs="h3" variant="collecting" />)
    expect(
      screen.getByRole("heading", { level: 3, name: "Nothing collected yet" })
    ).toBeInTheDocument()
  })
})

describe("location tab states on the shared state primitives", () => {
  it("loads as QueryPending with the tab's label", () => {
    render(<TabLoading label="Loading this location’s hours" />)
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading this location’s hours"
    )
  })

  it("fails as the Empty error state with a retry and the support details", () => {
    const onRetry = vi.fn()
    render(
      <TabError
        error={
          new ApiClientError(500, "internal_error", "Boom", undefined, {
            requestId: "req-123",
          })
        }
        onRetry={onRetry}
      />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveAttribute("data-variant", "error")
    expect(alert).toHaveTextContent("We couldn’t load this section")
    expect(alert).toHaveTextContent("Nothing was changed.")
    fireEvent.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(alert).toHaveTextContent("internal_error")
  })

  it("tells a location with no Google link apart from a failure", () => {
    render(
      <TabError
        error={new ApiClientError(409, "location_not_linked", "Not linked")}
        onRetry={() => {}}
      />
    )
    expect(screen.queryByRole("alert")).toBeNull()
    expect(
      screen.getByText("This location isn’t linked to Google yet")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("link", { name: "Link it in Setup" })
    ).toHaveAttribute("href", "/setup")
    expect(document.querySelector('[data-slot="empty"]')).toHaveAttribute(
      "data-variant",
      "not-enabled"
    )
  })
})
