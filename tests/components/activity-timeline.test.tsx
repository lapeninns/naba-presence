import { render, screen } from "@testing-library/react"
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
  })

  it("shows an empty note when nothing has happened", () => {
    render(<ActivityTimeline timezone="Europe/London" timeline={[]} />)
    expect(screen.getByText("No activity yet.")).toBeInTheDocument()
  })
})
