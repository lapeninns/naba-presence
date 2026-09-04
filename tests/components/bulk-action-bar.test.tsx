import { render, screen } from "@testing-library/react"
import * as React from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import { SelectionProvider, useSelection } from "@/components/inbox/selection-context"
import { Toaster } from "@/components/ui/toast"
import type { BulkReviewResult, ReviewRow } from "@/lib/contracts/reviews"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"
import * as membersHook from "@/lib/queries/use-members"

function row(
  id: string,
  overrides: Partial<ReviewRow> = {}
): ReviewRow {
  return {
    id,
    location: { id: "l1", name: "Girton", clientId: "c1", clientName: "Old Crown" },
    reviewer: { displayName: "Sam", isAnonymous: false, profilePhotoUrl: null },
    rating: 4,
    text: "Good",
    detectedLanguageCode: "en",
    languageConfidence: 1,
    createTime: "2026-09-01T10:00:00.000Z",
    updateTime: "2026-09-01T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "awaiting_approval",
    draftId: "d1",
    draftBody: "Thanks",
    verificationStatus: "pass",
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
    ...overrides,
  } as ReviewRow
}

const mutateAsync = vi.fn<
  (input: unknown) => Promise<BulkReviewResult>
>(async () => ({ results: [{ reviewId: "a", status: "ok" }] }))

function stub() {
  vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
  vi.spyOn(membersHook, "useMembers").mockReturnValue({
    data: {
      members: [{ userId: "u1", displayName: "Priya", email: "p@example.test" }],
    },
  } as unknown as ReturnType<typeof membersHook.useMembers>)
}

/** Selects the given ids, then renders the bar over `rows`. */
function Harness({ rows, select }: { rows: ReviewRow[]; select: string[] }) {
  const selection = useSelection()
  const applied = React.useRef(false)
  React.useEffect(() => {
    if (applied.current) return
    applied.current = true
    selection.replace(select)
  }, [selection, select])
  return <BulkActionBar rows={rows} />
}

function renderBar(rows: ReviewRow[], select: string[]) {
  stub()
  render(
    <Toaster>
      <SelectionProvider>
        <Harness rows={rows} select={select} />
      </SelectionProvider>
    </Toaster>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  mutateAsync.mockClear()
})

describe("BulkActionBar", () => {
  it("stays out of the way until something is selected", () => {
    renderBar([row("a")], [])
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
  })

  it("says how many rows an action will actually touch", async () => {
    // Pressing Approve on five rows and being told afterwards that two were
    // not yours to approve is the failure this replaces.
    renderBar(
      [
        row("a"),
        row("b", { workflowStatus: "new" }),
        row("c", { workflowStatus: "published" }),
      ],
      ["a", "b", "c"]
    )
    expect(await screen.findByText("3 selected")).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Approve 1 of 3" })
    ).toBeInTheDocument()
    expect(
      screen.getByText(/2 of these are not awaiting your approval/)
    ).toBeInTheDocument()
  })

  it("sends only the eligible rows to the server", async () => {
    const user = userEvent.setup()
    renderBar([row("a"), row("b", { workflowStatus: "new" })], ["a", "b"])
    await user.click(await screen.findByRole("button", { name: /^Approve/ }))
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "approve",
      reviewIds: ["a"],
    })
  })

  it("assigns to a named colleague", async () => {
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await user.click(await screen.findByRole("button", { name: /Assign/ }))
    await user.click(await screen.findByRole("menuitem", { name: "Priya" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "assign",
      reviewIds: ["a"],
      assigneeId: "u1",
    })
  })

  it("marks reviews as needing nothing", async () => {
    // A five-star review with no text needs no reply; before triage the only
    // way to clear it from the queue was to publish something.
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await user.click(await screen.findByRole("button", { name: "Mark reviewed" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "mark_reviewed",
      reviewIds: ["a"],
    })
  })

  it("reports per-row outcomes instead of failing the batch", async () => {
    mutateAsync.mockResolvedValueOnce({
      results: [
        { reviewId: "a", status: "ok" },
        { reviewId: "b", status: "skipped", code: "approval_not_pending" },
      ],
    })
    const user = userEvent.setup()
    renderBar([row("a"), row("b")], ["a", "b"])
    await user.click(await screen.findByRole("button", { name: /^Approve/ }))
    expect(await screen.findByText("Skipped")).toBeInTheDocument()
  })
})
