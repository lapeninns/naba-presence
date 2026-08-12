import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AttentionList } from "@/components/home/attention-list"
import type { AnalyticsLocation } from "@/lib/api/analytics"

function location(
  input: Pick<AnalyticsLocation, "id" | "name" | "unresolvedComplaints">
): AnalyticsLocation {
  return {
    reviews: 0,
    averageRating: null,
    responseRate: null,
    medianFirstResponseSeconds: null,
    p95FirstResponseSeconds: null,
    medianLatestEditSeconds: null,
    verificationRejectionRate: null,
    ...input,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("AttentionList", () => {
  it("is busy while pending", () => {
    const { container } = render(
      <AttentionList locations={undefined} isPending />
    )
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("lists the worst five locations, most complaints first, each linking to its inbox", () => {
    render(
      <AttentionList
        locations={[
          location({ id: "a", name: "Airport", unresolvedComplaints: 1 }),
          location({ id: "b", name: "Bridge", unresolvedComplaints: 9 }),
          location({ id: "c", name: "Central", unresolvedComplaints: 0 }),
          location({ id: "d", name: "Dockside", unresolvedComplaints: 4 }),
          location({ id: "e", name: "Eastgate", unresolvedComplaints: 7 }),
          location({ id: "f", name: "Ferry", unresolvedComplaints: 2 }),
          location({ id: "g", name: "Garden", unresolvedComplaints: 3 }),
        ]}
      />
    )
    const links = screen.getAllByRole("link")
    // Central (0) excluded; top five by desc: Bridge9, Eastgate7, Dockside4, Garden3, Ferry2
    expect(links).toHaveLength(5)
    expect(links[0]).toHaveAccessibleName(/Bridge/)
    expect(links[0]).toHaveAttribute("href", "/inbox?locationId=b&rating=1,2")
    expect(links[4]).toHaveAccessibleName(/Ferry/)
    expect(screen.queryByText(/Central/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Airport/)).not.toBeInTheDocument()
  })

  it("uses singular copy for a single complaint", () => {
    render(
      <AttentionList
        locations={[
          location({ id: "a", name: "Airport", unresolvedComplaints: 1 }),
        ]}
      />
    )
    expect(screen.getByText("1 unresolved complaint")).toBeInTheDocument()
  })

  it("shows an honest empty state when nothing needs attention", () => {
    render(
      <AttentionList
        locations={[
          location({ id: "a", name: "Airport", unresolvedComplaints: 0 }),
        ]}
      />
    )
    expect(
      screen.getByText(
        "No locations have unresolved low ratings in the last 30 days."
      )
    ).toBeInTheDocument()
    expect(screen.queryAllByRole("link")).toHaveLength(0)
  })

  it("offers a retry when errored", async () => {
    const user = userEvent.setup()
    const onRetry = vi.fn()
    render(<AttentionList locations={undefined} isError onRetry={onRetry} />)
    expect(
      screen.getByText("We could not load locations that need attention.")
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
})
