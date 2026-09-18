import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { QueueTabs } from "@/components/inbox/queue-tabs"
import {
  REVIEW_QUEUE_LABELS,
  type ReviewCounts,
  type ReviewQueue,
} from "@/lib/contracts/reviews"
import { VISIBLE_QUEUES } from "@/lib/inbox/url-state"

/**
 * A complete `byQueue`. Every key is required — the contract validates it as a
 * record keyed by the queue enum — and `approval` is the aggregate the tabs
 * actually read, so a fixture that omits it would test nothing the component
 * renders.
 */
function byQueue(overrides: Partial<Record<ReviewQueue, number>> = {}) {
  return {
    needs_reply: 12,
    approval: 5,
    awaiting_my_approval: 3,
    awaiting_others: 2,
    publishing: 1,
    failed: 4,
    done: 13,
    all: 35,
    ...overrides,
  }
}

function counts(overrides: Partial<Record<ReviewQueue, number>> = {}) {
  return {
    total: 35,
    byStatus: {},
    byQueue: byQueue(overrides),
  } satisfies ReviewCounts
}

function renderTabs(overrides: Partial<Parameters<typeof QueueTabs>[0]> = {}) {
  const props = {
    queue: "needs_reply" as ReviewQueue,
    counts: counts(),
    countsPending: false,
    onQueueChange: vi.fn(),
    ...overrides,
  }
  render(<QueueTabs {...props} />)
  return props
}

function nav() {
  return screen.getByRole("navigation", { name: "Review queues" })
}

function tab(queue: string) {
  const found = nav().querySelector(
    `[data-slot="queue-tab"][data-queue="${queue}"]`
  )
  if (!found) throw new Error(`No queue tab for ${queue}`)
  return found as HTMLElement
}

describe("QueueTabs", () => {
  it("is a landmark holding the five visible queues, labelled from the contract", () => {
    // The rail is gone, but these are still the inbox's primary navigation, so
    // the landmark a screen-reader user jumps to has to survive the move.
    renderTabs()
    const tabs = within(nav()).getAllByRole("button")
    expect(tabs.map((el) => el.dataset.queue)).toEqual([...VISIBLE_QUEUES])
    for (const queue of VISIBLE_QUEUES) {
      expect(
        within(tab(queue)).getByText(REVIEW_QUEUE_LABELS[queue])
      ).toBeInTheDocument()
    }
    // The two narrow approval queues are server scopes, not controls.
    expect(
      within(nav()).queryByText(REVIEW_QUEUE_LABELS.awaiting_my_approval)
    ).not.toBeInTheDocument()
    expect(
      within(nav()).queryByText(REVIEW_QUEUE_LABELS.awaiting_others)
    ).not.toBeInTheDocument()
  })

  it("announces each queue's count, including the new approval aggregate", () => {
    // The count sits in its own aria-hidden span with no whitespace before it,
    // so it has to be spelled into the accessible name or it announces as
    // "Needs reply12".
    renderTabs({ counts: counts({ approval: 5, publishing: 1 }) })
    expect(
      within(nav()).getByRole("button", { name: "Needs reply, 12 reviews" })
    ).toBeInTheDocument()
    expect(
      within(nav()).getByRole("button", { name: "Approval, 5 reviews" })
    ).toBeInTheDocument()
    // Singular, because "1 reviews" reads as a bug in the product.
    expect(
      within(nav()).getByRole("button", { name: "Publishing, 1 review" })
    ).toBeInTheDocument()
    expect(within(tab("approval")).getByText("5")).toBeInTheDocument()
  })

  it("shows a skeleton rather than a zero while the counts are in flight", () => {
    // A "0" before the number lands tells an operator there is nothing to do
    // when there may be plenty of it; the placeholder has to be honest about
    // not knowing yet.
    renderTabs({ counts: undefined, countsPending: true })
    for (const queue of VISIBLE_QUEUES) {
      const control = tab(queue)
      expect(
        control.querySelector('[data-slot="skeleton"]')
      ).toBeInTheDocument()
      expect(control.textContent).not.toMatch(/\d/)
      expect(control).toHaveAccessibleName(REVIEW_QUEUE_LABELS[queue])
    }
  })

  it("draws an empty queue as a dash but still says '0 reviews'", () => {
    // Sighted operators scan for a number and a dash reads as "nothing here"
    // faster than a 0 does; the announcement stays explicit so the distinction
    // between "empty" and "still loading" survives without the visual.
    renderTabs({ counts: counts({ publishing: 0 }) })
    expect(within(tab("publishing")).getByText("–")).toBeInTheDocument()
    expect(tab("publishing")).toHaveAccessibleName("Publishing, 0 reviews")
    expect(within(tab("publishing")).queryByText("0")).not.toBeInTheDocument()
  })

  it("marks the current queue with aria-current", () => {
    renderTabs({ queue: "failed" })
    expect(tab("failed")).toHaveAttribute("aria-current", "true")
    expect(tab("needs_reply")).not.toHaveAttribute("aria-current")
  })

  it.each(["awaiting_my_approval", "awaiting_others"] as const)(
    "lights the Approval tab for the legacy queue %s",
    (queue) => {
      // Approval is a presentation aggregate: the two narrow queues keep their
      // own server scope (and their own rows), and every deep link that names
      // one still means exactly what it always meant. Only the highlighted
      // control is shared, with the "Waiting on" filter carrying the ownership.
      renderTabs({ queue })
      expect(tab("approval")).toHaveAttribute("aria-current", "true")
      expect(
        within(nav())
          .getAllByRole("button")
          .filter((el) => el.getAttribute("aria-current"))
      ).toHaveLength(1)
    }
  )

  it("reports the visible queue id when a tab is clicked", async () => {
    const user = userEvent.setup()
    const { onQueueChange } = renderTabs({ queue: "needs_reply" })
    await user.click(within(nav()).getByRole("button", { name: /^Done,/ }))
    expect(onQueueChange).toHaveBeenCalledWith("done")
  })

  it("moves a legacy approval scope back to the aggregate when its tab is clicked", async () => {
    // Clicking the control has to mean the control: the operator asked for
    // Approval, not for the narrower "waiting on me" slice they arrived in.
    const user = userEvent.setup()
    const { onQueueChange } = renderTabs({ queue: "awaiting_my_approval" })
    await user.click(within(nav()).getByRole("button", { name: /^Approval,/ }))
    expect(onQueueChange).toHaveBeenCalledWith("approval")
  })

  it("describes the nav with the note about what the counts cover", () => {
    // The counts endpoint is scoped by queue and client and knows nothing of
    // the rating, search, age or assignee filters the list applies, so the
    // numbers here can legitimately exceed the rows below. Saying so is
    // cheaper than a badge that quietly disagrees with the list.
    renderTabs()
    const describedBy = nav().getAttribute("aria-describedby")
    expect(describedBy).toBeTruthy()
    const note = document.getElementById(describedBy!)
    expect(note).toHaveTextContent(
      "Counts cover every review in each queue for the current client scope."
    )
    expect(note).toHaveTextContent(
      "The list below also applies your filters, so it can show fewer."
    )
  })
})
