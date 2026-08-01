import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QueueTabs } from "@/components/inbox/queue-tabs"

const byStatus = {
  new: 2,
  drafted: 1,
  verified: 0,
  awaiting_approval: 3,
  publish_requested: 0,
  published: 5,
  rejected: 1,
  failed: 0,
  escalated: 4,
}

afterEach(() => vi.restoreAllMocks())

describe("QueueTabs", () => {
  it("labels each tab with its derived count and marks the active queue selected", () => {
    render(<QueueTabs queue="all" total={16} byStatus={byStatus} onQueueChange={() => {}} />)
    // All reviews = total; needs_reply = new+drafted+verified+failed+rejected = 4
    expect(screen.getByRole("tab", { name: /All reviews,\s+16/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Needs reply,\s+4/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Awaiting approval,\s+3/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Escalated,\s+4/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /Published,\s+5/ })).toBeInTheDocument()
    expect(screen.getByRole("tab", { name: /All reviews,\s+16/ })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })

  it("calls onQueueChange when a tab is chosen", async () => {
    const user = userEvent.setup()
    const onQueueChange = vi.fn()
    render(
      <QueueTabs queue="all" total={16} byStatus={byStatus} onQueueChange={onQueueChange} />
    )
    await user.click(screen.getByRole("tab", { name: /Published/ }))
    expect(onQueueChange).toHaveBeenCalledWith("published")
  })
})
