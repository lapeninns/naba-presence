import { act, render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { formatInstant } from "@/components/editors/change-diff"
import {
  attemptOutcome,
  Expiry,
  OutcomeSummary,
  ReviewedWritePanel,
  reviewedWriteSteps,
  SummaryList,
} from "@/components/reviewed-write"

afterEach(() => vi.useRealTimers())

describe("attemptOutcome", () => {
  it("only calls an independently confirmed attempt applied", () => {
    expect(attemptOutcome("accepted", "confirmed")).toBe("confirmed_applied")
    expect(attemptOutcome("accepted", "pending")).toBe("awaiting_confirmation")
    expect(attemptOutcome("pending", "unrecorded")).toBe("awaiting_confirmation")
  })
  it("never calls an unreadable answer failed", () => {
    expect(attemptOutcome("unknown", "unrecorded")).toBe("uncertain")
    expect(attemptOutcome("accepted", "unresolved")).toBe("uncertain")
    expect(attemptOutcome("unrecorded", "unrecorded")).toBe("uncertain")
  })
  it("reports a rejection as a rejection whatever the check says", () => {
    expect(attemptOutcome("rejected", "unresolved")).toBe("rejected")
  })
})

describe("reviewedWriteSteps", () => {
  it("marks the current step and everything before it", () => {
    expect(reviewedWriteSteps("approve").map((step) => step.state)).toEqual(["done", "current", "todo", "todo"])
    expect(reviewedWriteSteps("send").map((step) => step.state)).toEqual(["done", "done", "current", "todo"])
    expect(reviewedWriteSteps("outcome").map((step) => step.state)).toEqual(["done", "done", "done", "current"])
  })
  it("says when another person must approve", () => {
    expect(reviewedWriteSteps("approve", { secondApprover: true })[1]?.meta).toBe("Another person")
  })
})

describe("Expiry", () => {
  const at = "2026-09-30T08:00:00.000Z"
  it("states an open deadline in local time", () => {
    render(<Expiry expiresAt={at} approved={false} clockExpired={false} />)
    expect(screen.getByText(/^Review expires/)).toHaveTextContent(`Review expires ${formatInstant(at)}.`)
    expect(screen.getByText(formatInstant(at))).toHaveAttribute("dateTime", at)
  })
  it("never shows a future-looking time for a server-reported expiry", () => {
    const { rerender } = render(<Expiry expiresAt="2099-01-01T00:00:00Z" approved clockExpired={false} reportedExpired />)
    expect(screen.getByText("Approval has expired.")).toBeInTheDocument()
    rerender(<Expiry expiresAt="2099-01-01T00:00:00Z" approved clockExpired={false} reportedExpired reportedAt={at} />)
    expect(screen.getByText(/^Approval expired · checked/)).toHaveTextContent(formatInstant(at))
    expect(screen.queryByText(/2099/)).not.toBeInTheDocument()
  })
})

describe("SummaryList", () => {
  it("puts technical references after the human rows, collapsed", () => {
    render(<SummaryList rows={[{ label: "Google location", value: "locations/1", technical: true }, { label: "Listing", value: "Camden Hotel" }]} />)
    const details = screen.getByText("Technical details").closest("details")
    expect(details).not.toHaveAttribute("open")
    expect(within(details as HTMLElement).getByText("locations/1")).toBeInTheDocument()
    expect(screen.getByText("Camden Hotel").compareDocumentPosition(details as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})

describe("OutcomeSummary", () => {
  it("uses the shared outcome words and the one recorded-state vocabulary", () => {
    render(<OutcomeSummary execution="accepted" confirmation="unresolved" observedAt={null} />)
    expect(screen.getByRole("status")).toHaveTextContent("Couldn’t confirm with Google")
    expect(screen.getByText("Accepted by Google")).toBeInTheDocument()
    expect(screen.getByText("Independent confirmation unresolved")).toBeInTheDocument()
    expect(screen.getByText("No dated observation recorded")).toBeInTheDocument()
  })
})

describe("ReviewedWritePanel", () => {
  it("moves focus to its heading when a review opens and again after a closing dialog returns focus", () => {
    vi.useFakeTimers()
    const trigger = document.createElement("button")
    document.body.append(trigger)
    const { rerender } = render(<ReviewedWritePanel id="review" title="Review access request" focusKey={null}>body</ReviewedWritePanel>)
    expect(document.activeElement).not.toBe(screen.getByRole("heading", { name: "Review access request" }))
    rerender(<ReviewedWritePanel id="review" title="Review access request" focusKey="r1" stage="approve">body</ReviewedWritePanel>)
    const heading = screen.getByRole("heading", { name: "Review access request" })
    expect(document.activeElement).toBe(heading)
    trigger.focus()
    act(() => { vi.advanceTimersByTime(500) })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByRole("region", { name: "Review access request" })).toContainElement(screen.getByRole("list", { name: "Steps to send this change" }))
    trigger.remove()
  })
})
