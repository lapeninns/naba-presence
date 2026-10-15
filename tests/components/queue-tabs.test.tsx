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

/** The queues that draw a figure while `needs_reply` is the current one. */
const FIGURED = VISIBLE_QUEUES.filter((queue) => queue !== "needs_reply")

const modeMock = vi.hoisted(() => vi.fn(() => "agency"))
vi.mock("@/lib/workspace/mode", () => ({ useWorkspaceMode: () => modeMock() }))

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
      within(nav()).getByRole("button", { name: "Approval, 5 reviews" })
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

  it("draws each number once: not on Needs reply (the title's) or on the current queue (the list header's)", () => {
    // "Inbox 12", "Needs reply 12" and "12 reviews" was the same number three
    // times. The title carries Needs reply, the list header the current
    // queue, and the other queues keep their own figures.
    renderTabs({ queue: "failed" })
    for (const queue of ["needs_reply", "failed"] as const) {
      expect(tab(queue).querySelector('[data-slot="tab-count"]')).toBeNull()
      expect(tab(queue)).toHaveAccessibleName(REVIEW_QUEUE_LABELS[queue])
    }
    expect(within(tab("approval")).getByText("5")).toBeInTheDocument()
    expect(within(tab("done")).getByText("13")).toBeInTheDocument()
  })

  it("draws no figure at all while a filter narrows the list", () => {
    // The counts cover whole queues and know nothing of the filters, so a
    // "5" beside a list of two rows would disagree with it. The list header
    // carries the number that matches the rows.
    renderTabs({ filtered: true })
    for (const queue of VISIBLE_QUEUES) {
      expect(tab(queue).querySelector('[data-slot="tab-count"]')).toBeNull()
      expect(tab(queue)).toHaveAccessibleName(REVIEW_QUEUE_LABELS[queue])
    }
    expect(nav()).not.toHaveAttribute("aria-describedby")
  })

  it("shows a skeleton rather than a zero while the counts are in flight", () => {
    // A "0" before the number lands tells an operator there is nothing to do
    // when there may be plenty of it; the placeholder has to be honest about
    // not knowing yet.
    renderTabs({ counts: undefined, countsPending: true })
    for (const queue of FIGURED) {
      const control = tab(queue)
      expect(
        control.querySelector('[data-slot="skeleton"]')
      ).toBeInTheDocument()
      expect(control.textContent).not.toMatch(/\d/)
      expect(control).toHaveAccessibleName(REVIEW_QUEUE_LABELS[queue])
    }
    // Needs reply and the current queue have no figure to wait for.
    expect(
      tab("needs_reply").querySelector('[data-slot="skeleton"]')
    ).toBeNull()
  })

  it("draws an empty queue with no figure but still says '0 reviews'", () => {
    // The one zero rule (TabCount): no dash, which reads as "unknown", and no
    // "0". The announcement stays explicit so "empty" is still told apart
    // from "still loading" (a skeleton) without the visual.
    renderTabs({ counts: counts({ publishing: 0 }) })
    const empty = tab("publishing")
    expect(empty.querySelector('[data-slot="tab-count"]')).toBeNull()
    expect(within(empty).queryByText("–")).not.toBeInTheDocument()
    expect(within(empty).queryByText("0")).not.toBeInTheDocument()
    expect(empty).toHaveAccessibleName("Publishing, 0 reviews")
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
    await user.click(within(nav()).getByRole("button", { name: /^Approval/ }))
    expect(onQueueChange).toHaveBeenCalledWith("approval")
  })

  it("describes the nav with the note about what the counts cover", () => {
    // The counts endpoint is scoped by queue and client and knows nothing of
    // the rating, search, age or assignee filters the list applies, so the
    // numbers here can legitimately exceed the rows below. Saying so is
    // cheaper than a badge that quietly disagrees with the list. (While a
    // filter is on the counts are not drawn at all, so there is no note.)
    renderTabs()
    const describedBy = nav().getAttribute("aria-describedby")
    expect(describedBy).toBeTruthy()
    const note = document.getElementById(describedBy!)
    expect(note).toHaveTextContent(
      "Counts cover every review in each queue for the current client scope."
    )
  })

  it("does not name a client scope in a business", () => {
    modeMock.mockReturnValueOnce("business")
    renderTabs()
    const note = document.getElementById(
      nav().getAttribute("aria-describedby")!
    )
    expect(note).toHaveTextContent("Counts cover every review in each queue.")
    expect(note).not.toHaveTextContent(/client/i)
  })
  it("sets every count in the count role, never a sub-13px figure", () => {
    renderTabs()
    for (const queue of FIGURED) {
      const figure = tab(queue).querySelector("[aria-hidden]")
      expect(figure).toHaveClass("text-count")
      expect(figure?.className).not.toMatch(/text-\[/)
    }
  })

  it("draws the queues as text tabs: the current one in ink, weight and an underline", () => {
    renderTabs({ queue: "failed" })
    const current = tab("failed")
    const other = tab("needs_reply")
    for (const control of [current, other]) {
      // The primitive text tab (`textTabItemClassName`), its current-tab
      // cue said for `aria-current="true"` as well as "page".
      expect(control).toHaveClass(
        "text-body",
        "font-normal",
        "text-ink-secondary",
        "after:h-0.5",
        "aria-[current=true]:font-semibold",
        "aria-[current=true]:text-ink",
        "aria-[current=true]:after:bg-ink",
        // 44px tall and wide on touch.
        "h-11",
        "min-w-(--np-touch)"
      )
      // No segmented thumb and no accent tint on the current queue.
      expect(control.className).not.toMatch(/shadow-np-raised|accent/)
    }
    // The primitive chip row: one sideways-scrolling row with faded edges,
    // no track fill behind the tabs.
    const strip = nav().querySelector('[data-slot="queue-strip"]')
    expect(strip).toHaveClass("overflow-x-auto")
    expect(strip?.className).not.toMatch(/(^|\s)bg-/)
  })

  it("sets counts in sans tabular figures, a non-zero Failed in the danger ink", () => {
    renderTabs({ counts: counts({ failed: 4 }) })
    for (const queue of FIGURED) {
      const figure = tab(queue).querySelector("[aria-hidden]")
      expect(figure).toHaveClass("tabular-nums")
      expect(figure).not.toHaveClass("font-mono")
    }
    expect(tab("failed").querySelector("[aria-hidden]")).toHaveClass(
      "text-danger-ink",
      "font-semibold"
    )
  })

  it("scrolls the strip, not the page, to the current queue on arrival", () => {
    // A link to ?queue=failed on a 360px phone lands with Failed off the end
    // of the strip unless the strip itself is moved; scrollIntoView would
    // drag the page to the toolbar as well.
    const order = [...VISIBLE_QUEUES] as string[]
    const scrollIntoView = vi.fn()
    const restore = [
      stub("offsetLeft", function (this: HTMLElement) {
        const index = order.indexOf(this.dataset.queue ?? "")
        return index < 0 ? 0 : index * 100
      }),
      stub("offsetWidth", () => 100),
      stub("scrollWidth", function (this: HTMLElement) {
        return this.dataset.slot === "queue-strip" ? 500 : 0
      }),
      stub("clientWidth", function (this: HTMLElement) {
        return this.dataset.slot === "queue-strip" ? 200 : 0
      }),
    ]
    const originalScrollIntoView = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView
    try {
      renderTabs({ queue: "failed" })
      const strip = nav().querySelector<HTMLElement>(
        '[data-slot="queue-strip"]'
      )!
      // Failed spans 300–400; it is kept clear of the row's 40px (2.5rem)
      // fading edge.
      expect(strip.scrollLeft).toBe(400 + 40 - 200)
      expect(scrollIntoView).not.toHaveBeenCalled()
    } finally {
      restore.forEach((undo) => undo())
      Element.prototype.scrollIntoView = originalScrollIntoView
    }
  })
})

/** Overrides a layout getter jsdom always answers with 0; returns the undo. */
function stub(
  name: "offsetLeft" | "offsetWidth" | "scrollWidth" | "clientWidth",
  get: (this: HTMLElement) => number
) {
  const proto =
    name === "scrollWidth" || name === "clientWidth"
      ? Element.prototype
      : HTMLElement.prototype
  const original = Object.getOwnPropertyDescriptor(proto, name)
  Object.defineProperty(proto, name, { configurable: true, get })
  return () => {
    if (original) Object.defineProperty(proto, name, original)
  }
}
