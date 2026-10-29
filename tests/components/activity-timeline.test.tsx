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
    expect(screen.getByText("Reply approved")).toBeInTheDocument()
    // One heading (the dialog's); the order is said, not implied.
    expect(screen.getByText("2 events, newest first")).toBeInTheDocument()
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(
      screen.getByRole("list", { name: "Activity events" })
    ).toBeInTheDocument()
    expect(
      screen.queryByText("Additional audit details recorded")
    ).not.toBeInTheDocument()
  })

  it("names triage and assignment in plain words, and keeps a fallback", () => {
    const at = "2026-07-30T10:05:00.000Z"
    render(
      <ActivityTimeline
        timezone="Europe/London"
        timeline={[
          {
            action: "review.triaged",
            createdAt: at,
            actorName: null,
            metadataSummary: null,
          },
          {
            action: "review.untriaged",
            createdAt: at,
            actorName: null,
            metadataSummary: null,
          },
          {
            action: "review.assigned",
            createdAt: at,
            actorName: null,
            metadataSummary: null,
          },
          {
            action: "review.draft.edited",
            createdAt: at,
            actorName: null,
            metadataSummary: null,
          },
          {
            action: "review.reply.diverged",
            createdAt: at,
            actorName: null,
            metadataSummary: null,
          },
        ]}
      />
    )
    expect(screen.getByText("Marked as no reply needed")).toBeInTheDocument()
    expect(screen.getByText("Put back in Needs reply")).toBeInTheDocument()
    expect(screen.getByText("Assignment changed")).toBeInTheDocument()
    expect(screen.getByText("Draft saved")).toBeInTheDocument()
    // Not in the map: still words, from the audit key.
    expect(screen.getByText("Reply diverged")).toBeInTheDocument()
  })

  it("shows an empty note when nothing has happened", () => {
    render(<ActivityTimeline timezone="Europe/London" timeline={[]} />)
    expect(screen.getByText("No activity yet")).toBeInTheDocument()
  })
})
