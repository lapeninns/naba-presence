import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  ReviewedChangeSheet,
  type ReviewedChangeWorkflow,
} from "@/components/locations/profile/sections/reviewed-change-sheet"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"

function workflow(
  review: Partial<GbpChangeSet> = {},
  rest: Partial<ReviewedChangeWorkflow> = {}
): ReviewedChangeWorkflow {
  return {
    review: {
      id: "review-1",
      approvedBy: null,
      expiresAt: "2999-01-01T00:00:00Z",
      locationName: "Corner House",
      targetResourceName: "locations/1",
      canApprove: true,
      requiresSecondApprover: false,
      ...review,
    } as unknown as GbpChangeSet,
    outcome: null,
    busy: false,
    error: null,
    open: true,
    uncertain: false,
    unresolved: false,
    stale: false,
    selectionRevision: 0,
    approve: () => {},
    send: () => {},
    check: () => {},
    setOpen: () => {},
    ...rest,
  }
}

function sheet(flow: ReviewedChangeWorkflow) {
  return render(
    <ReviewedChangeSheet
      workflow={flow}
      noun="lodging"
      rows={[]}
      disabled={false}
    />
  )
}

const steps = () =>
  screen.getByRole("list", { name: "Steps to send this change" })

describe("ReviewedChangeSheet", () => {
  it("says why Approve is off when this person can't approve", () => {
    sheet(workflow({ canApprove: false }))
    expect(
      screen.getByRole("button", { name: "Approve lodging changes" })
    ).toBeDisabled()
    expect(
      screen.getByText(
        "Your current permissions don’t allow approving these changes."
      )
    ).toBeInTheDocument()
  })

  it("leaves a two-person review to its second-approver line", () => {
    sheet(workflow({ canApprove: false, requiresSecondApprover: true }))
    expect(
      screen.getByText(
        /A different current owner or administrator must approve/
      )
    ).toBeInTheDocument()
    expect(within(steps()).getByText("Another person")).toBeInTheDocument()
    expect(
      screen.queryByText(/permissions don’t allow/)
    ).not.toBeInTheDocument()
  })

  it("asks for the consent tick before the green send, and drops the note once ticked", async () => {
    sheet(workflow({ approvedBy: "user-2" }))
    const send = screen.getByRole("button", {
      name: "Send approved lodging changes",
    })
    expect(send).toBeDisabled()
    expect(send).toHaveAttribute("data-variant", "send")
    expect(
      screen.getByText("Tick the box to send these exact lodging changes.")
    ).toBeInTheDocument()
    await userEvent.click(screen.getByRole("checkbox"))
    expect(send).toBeEnabled()
    expect(screen.queryByText(/Tick the box/)).not.toBeInTheDocument()
  })

  it("says sending is paused while another change is unresolved", () => {
    sheet(workflow({ approvedBy: "user-2" }, { unresolved: true }))
    expect(
      screen.getByText(
        "Sending is paused while another Google change is unresolved."
      )
    ).toBeInTheDocument()
  })

  it("never calls an accepted send On Google before the independent check", () => {
    sheet(
      workflow(
        { approvedBy: "user-2" },
        {
          outcome: { executionState: "accepted", confirmationState: "pending" },
        }
      )
    )
    expect(
      within(steps()).getByText("Sent, waiting for Google")
    ).toBeInTheDocument()
    expect(within(steps()).queryByText("On Google")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Send approved/ })
    ).not.toBeInTheDocument()
  })

  it("ticks the outcome step as On Google once Google is confirmed", () => {
    sheet(
      workflow(
        { approvedBy: "user-2" },
        {
          outcome: {
            executionState: "accepted",
            confirmationState: "confirmed",
            observedAt: "2026-11-04T09:00:00Z",
          },
        }
      )
    )
    const outcome = within(steps()).getByText("On Google").closest("li")
    expect(outcome).toHaveAttribute("data-state", "done")
  })
})
