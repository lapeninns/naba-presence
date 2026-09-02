import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActivityTimeline } from "@/components/inbox/activity-timeline"

afterEach(() => vi.restoreAllMocks())

describe("ActivityTimeline", () => {
  it("humanises actions and shows the actor name", () => {
    render(
      <ActivityTimeline
        timezone="Europe/London"
        timeline={[
          {
            action: "review.draft.generated",
            createdAt: "2026-07-30T10:05:00.000Z",
            actorName: "Alex Owner",
            metadataSummary: null,
          },
          {
            action: "review.approval.approved",
            createdAt: "2026-07-30T11:00:00.000Z",
            actorName: null,
            metadataSummary: "Additional audit details recorded",
          },
        ]}
      />
    )
    expect(screen.getByText("Draft generated")).toBeInTheDocument()
    expect(screen.getByText(/Alex Owner/)).toBeInTheDocument()
    expect(screen.getByText("Approval approved")).toBeInTheDocument()
    expect(
      screen.getByRole("list", { name: "Activity events" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Additional audit details recorded")
    ).not.toBeInTheDocument()
  })

  it("shows an empty note when nothing has happened", () => {
    render(<ActivityTimeline timezone="Europe/London" timeline={[]} />)
    expect(screen.getByText("No activity yet")).toBeInTheDocument()
  })

  it("keeps a collapsible audit feed mounted and reveals it on request", () => {
    render(
      <ActivityTimeline
        timezone="Europe/London"
        collapsible
        timeline={[
          {
            action: "review.draft.generated",
            createdAt: "2026-07-30T10:05:00.000Z",
            actorName: "Alex Owner",
            metadataSummary: "Additional audit details recorded",
          },
        ]}
      />
    )

    const toggle = screen.getByRole("button", {
      name: "Activity, 1 event",
    })
    const event = screen.getByText("Draft generated")

    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(event).not.toBeVisible()

    fireEvent.click(toggle)

    expect(toggle).toHaveAttribute("aria-expanded", "true")
    expect(event).toBeVisible()
  })
})
