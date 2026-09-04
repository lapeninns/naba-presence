import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { InboxRail } from "@/components/inbox/inbox-rail"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import type { InboxState } from "@/lib/inbox/url-state"

const state: InboxState = {
  queue: "needs_reply",
  locationIds: [],
  ratings: [],
  search: "",
  sort: "updated_desc",
  verification: [],
  publishStatus: [],
  syncStatus: [],
}

const counts: ReviewCounts = {
  total: 30,
  byStatus: {},
  byQueue: {
    needs_reply: 12,
    awaiting_my_approval: 3,
    awaiting_others: 0,
    publishing: 0,
    failed: 2,
    done: 13,
    all: 30,
  },
  groups: [
    {
      clientId: "c1",
      clientName: "Old Crown Group",
      byQueue: {
        needs_reply: 9,
        awaiting_my_approval: 3,
        awaiting_others: 0,
        publishing: 0,
        failed: 0,
        done: 8,
        all: 20,
      },
    },
    {
      clientId: "c2",
      clientName: "Harbour Kitchen",
      byQueue: {
        needs_reply: 3,
        awaiting_my_approval: 0,
        awaiting_others: 0,
        publishing: 0,
        failed: 2,
        done: 5,
        all: 10,
      },
    },
  ],
}

const clients = [
  { id: "c1", name: "Old Crown Group", health: "healthy" as const },
  { id: "c2", name: "Harbour Kitchen", health: "disconnected" as const },
]

function renderRail(overrides: Partial<Parameters<typeof InboxRail>[0]> = {}) {
  const props = {
    state,
    counts,
    countsPending: false,
    clients,
    onQueueChange: vi.fn(),
    onSelectView: vi.fn(),
    onSelectClientQueue: vi.fn(),
    ...overrides,
  }
  render(<InboxRail {...props} />)
  return props
}

describe("InboxRail", () => {
  it("puts the whole agency's queues above the per-client ones", () => {
    renderRail()
    const rail = screen.getByRole("navigation", { name: "Review queues" })
    expect(within(rail).getByRole("button", { name: "Needs reply, 12 reviews" })).toBeInTheDocument()
    expect(
      within(rail).getByRole("button", { name: "Awaiting my approval, 3 reviews" })
    ).toBeInTheDocument()
  })

  it("groups by client, which is what an agency actually asks", () => {
    renderRail()
    expect(
      screen.getByRole("button", { name: /Collapse Old Crown Group|Expand Old Crown Group/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Collapse Harbour Kitchen|Expand Harbour Kitchen/ })
    ).toBeInTheDocument()
  })

  it("flags a client that is not syncing", () => {
    // A queue count of zero for a disconnected client means "we cannot see",
    // not "nothing to do", and the two must not look identical.
    renderRail()
    const group = screen.getByRole("button", {
      name: /Collapse Harbour Kitchen|Expand Harbour Kitchen/,
    })
    expect(within(group).getByText("Not syncing with Google")).toBeInTheDocument()
  })

  it("hides queues that are empty and would only be noise", () => {
    // A client with no failed publishes should not carry a Failed row; the
    // rail exists to surface work, not to enumerate states.
    renderRail()
    const rail = screen.getByRole("navigation", { name: "Review queues" })
    expect(
      within(rail).queryByRole("button", { name: /^Publishing/ })
    ).not.toBeInTheDocument()
    expect(within(rail).getByRole("button", { name: "Failed, 2 reviews" })).toBeInTheDocument()
  })

  it("shows a placeholder rather than a zero before the counts land", () => {
    // "0" before the count arrives says there is nothing to do when there may
    // be plenty.
    renderRail({ counts: undefined, countsPending: true })
    const rail = screen.getByRole("navigation", { name: "Review queues" })
    expect(within(rail).getByRole("button", { name: "Needs reply" })).toBeInTheDocument()
  })

  it("marks exactly one row as current", () => {
    renderRail()
    const rail = screen.getByRole("navigation", { name: "Review queues" })
    const current = within(rail)
      .getAllByRole("button")
      .filter((button) => button.getAttribute("aria-current") === "true")
    expect(current).toHaveLength(1)
    expect(current[0]).toHaveAccessibleName(/^Needs reply/)
  })

  it("selects a client's own queue rather than the agency-wide one", async () => {
    const user = userEvent.setup()
    const props = renderRail()
    // Expand, then choose that client's own Needs reply.
    const group = screen.getByRole("button", {
      name: /Collapse Harbour Kitchen|Expand Harbour Kitchen/,
    })
    if (group.getAttribute("aria-expanded") === "false") await user.click(group)
    await user.click(
      screen.getByRole("button", { name: "Harbour Kitchen, Needs reply, 3 reviews" })
    )
    expect(props.onSelectClientQueue).toHaveBeenCalledWith("c2", "needs_reply")
  })

  it("offers the saved views", async () => {
    const user = userEvent.setup()
    const props = renderRail()
    await user.click(screen.getByRole("button", { name: "1–2 stars, unanswered" }))
    expect(props.onSelectView).toHaveBeenCalledWith("unhappy-unanswered")
  })
})
