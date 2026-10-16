import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, within } from "@testing-library/react"
import * as React from "react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { BulkActionBar } from "@/components/inbox/bulk-action-bar"
import {
  SelectionProvider,
  useSelection,
} from "@/components/inbox/selection-context"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import { Toaster } from "@/components/ui/toast"
import type { BulkReviewResult, ReviewRow } from "@/lib/contracts/reviews"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"
import * as membersHook from "@/lib/queries/use-members"
import * as sessionHook from "@/lib/queries/use-session"

function row(id: string, overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id,
    location: {
      id: "l1",
      name: "Girton",
      clientId: "c1",
      clientName: "Old Crown",
    },
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
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
    ...overrides,
  } as ReviewRow
}

const mutateAsync = vi.fn<(input: unknown) => Promise<BulkReviewResult>>(
  async () => ({ results: [{ reviewId: "a", status: "ok" }] })
)

function stub() {
  vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
    mutateAsync,
    isPending: false,
  } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
  // The team list is only for an owner or admin to read.
  vi.spyOn(sessionHook, "useSession").mockReturnValue({
    data: { session: { userId: "me-1", role: "owner" } },
    isError: false,
  } as unknown as ReturnType<typeof sessionHook.useSession>)
  vi.spyOn(membersHook, "useMembers").mockReturnValue({
    data: {
      members: [
        {
          userId: "u1",
          displayName: "Priya",
          email: "p@example.test",
          role: "member",
          locations: [],
        },
        {
          userId: "u2",
          displayName: "Vic",
          email: "v@example.test",
          role: "viewer",
          locations: [],
        },
        {
          userId: "u3",
          displayName: "Sol",
          email: "s@example.test",
          role: "member",
          locations: [{ locationId: "l2", canPublish: true }],
        },
        {
          userId: "u4",
          displayName: "Lin",
          email: "l@example.test",
          role: "member",
          locations: [{ locationId: "l1", canPublish: false }],
        },
      ],
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
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Toaster>
        <SelectionProvider>
          <Harness rows={rows} select={select} />
        </SelectionProvider>
      </Toaster>
    </QueryClientProvider>
  )
}

async function openAssign(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "More actions" }))
  await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
}

/** A portrait phone: overlays and menus present as bottom sheets. */
function asPhone() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_OVERLAY_QUERY || query === "(pointer: coarse)",
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  mutateAsync.mockClear()
})

describe("BulkActionBar", () => {
  it("stays out of the way until something is selected", () => {
    const { container } = renderBar([row("a")], [])
    expect(screen.queryByText(/selected/)).not.toBeInTheDocument()
    // Not docked either: the phone's tab bar keeps the bottom edge.
    expect(container.querySelector('[data-docked="bottom"]')).toBeNull()
  })

  it("docks to the bottom edge only while rows are ticked", async () => {
    renderBar([row("a")], ["a"])
    const bar = await screen.findByRole("region", { name: "Selected reviews" })
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar).toHaveAttribute("data-slot", "bulk-action-bar")
    // The shared SelectionBar's dock: fixed on a phone, sticky from md,
    // riding the keyboard, with a spacer keeping the last row reachable
    // above it.
    expect(bar).toHaveClass("md:sticky", "z-chrome", "max-md:fixed")
    expect(bar.className).toContain(
      "max-md:pb-[max(--spacing(2),var(--np-dock-bottom))]"
    )
    expect(
      bar.parentElement?.querySelector('[data-slot="selection-bar-spacer"]')
    ).not.toBeNull()
  })

  it("keeps one primary and puts the rest in the overflow menu", async () => {
    const user = userEvent.setup()
    renderBar(
      [
        row("a"),
        row("b", { text: null, workflowStatus: "new", draftId: null }),
      ],
      ["a", "b"]
    )
    expect(
      await screen.findByRole("button", { name: "Approve 1 of 2" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "No reply needed" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "More actions" }))
    expect(
      await screen.findByRole("menuitem", { name: "Assign…" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: "No reply needed" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("menuitem", { name: "Reply with template" })
    ).toBeInTheDocument()
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
      screen.getByText(/2 of these are not ready for your approval/)
    ).toBeInTheDocument()
  })

  it("sends only the eligible rows to the server", async () => {
    const user = userEvent.setup()
    renderBar([row("a"), row("b", { workflowStatus: "new" })], ["a", "b"])
    await user.click(await screen.findByRole("button", { name: /^Approve/ }))
    await user.click(
      screen.getByRole("button", { name: "Approve and publish 1" })
    )
    // Bound to what the list showed: the draft and the review's version.
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "approve",
      approvals: [
        {
          reviewId: "a",
          draftId: "d1",
          reviewUpdateTime: "2026-09-01T10:00:00.000Z",
        },
      ],
    })
  })

  // Single approve names the parked draft; so does bulk. The newest draft can
  // be one nobody submitted, which the server would refuse.
  it("approves the parked draft, not a newer one", async () => {
    const user = userEvent.setup()
    renderBar([row("a", { draftId: "newer", pendingDraftId: "parked" })], ["a"])
    await user.click(await screen.findByRole("button", { name: /^Approve/ }))
    await user.click(
      screen.getByRole("button", { name: "Approve and publish 1" })
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "approve",
      approvals: [
        {
          reviewId: "a",
          draftId: "parked",
          reviewUpdateTime: "2026-09-01T10:00:00.000Z",
        },
      ],
    })
  })

  it("does not offer to approve a row with no draft to read", async () => {
    renderBar([row("a"), row("b", { draftId: null })], ["a", "b"])
    expect(
      await screen.findByRole("button", { name: "Approve 1 of 2" })
    ).toBeInTheDocument()
  })

  // Under two-person approval the route refuses a reply this person asked
  // for or drafted, so the bar neither counts it in "Approve N" nor sends it.
  it("leaves out replies the current user cannot approve", async () => {
    const user = userEvent.setup()
    renderBar(
      [
        row("a"),
        row("own", { canApprove: false }),
        row("b", { canApprove: true }),
      ],
      ["a", "own", "b"]
    )
    expect(
      await screen.findByRole("button", { name: "Approve 2 of 3" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Approve 2 of 3" }))
    await user.click(
      screen.getByRole("button", { name: "Approve and publish 2" })
    )
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "approve",
      approvals: [
        expect.objectContaining({ reviewId: "a" }),
        expect.objectContaining({ reviewId: "b" }),
      ],
    })
  })

  it("offers no Approve when every selected reply is the user's own", async () => {
    renderBar([row("own", { canApprove: false })], ["own"])
    expect(await screen.findByText("1 selected")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /^Approve/ })
    ).not.toBeInTheDocument()
  })

  it("assigns to a named colleague", async () => {
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await openAssign(user)
    const priya = await screen.findByRole("menuitem", { name: "Priya" })
    // By keyboard: jsdom has no layout, so Base UI's submenu ignores a
    // synthetic pointer that never "travelled" into it.
    priya.focus()
    await user.keyboard("{Enter}")
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "assign",
      reviewIds: ["a"],
      assigneeId: "u1",
    })
  })

  it("offers only assignees the server would accept for the chosen rows", async () => {
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await openAssign(user)
    expect(
      await screen.findByRole("menuitem", { name: "Priya" })
    ).toBeInTheDocument()
    expect(screen.getByRole("menuitem", { name: "Lin" })).toBeInTheDocument()
    // A viewer, and a member scoped to another location, would be skipped
    // as assignee_not_eligible on every row.
    expect(
      screen.queryByRole("menuitem", { name: "Vic" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Sol" })
    ).not.toBeInTheDocument()
  })

  // Approving publishes, so a batch of it is confirmed like any publish.
  it("confirms before approving and publishing, and Cancel sends nothing", async () => {
    const user = userEvent.setup()
    renderBar([row("a"), row("b")], ["a", "b"])
    await user.click(await screen.findByRole("button", { name: "Approve 2" }))
    expect(
      screen.getByRole("alertdialog", {
        name: "Approve and publish 2 replies to Google?",
      })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("marks reviews as needing nothing, once confirmed", async () => {
    // A five-star review with no text needs no reply; before triage the only
    // way to clear it from the queue was to publish something. There is no
    // way to put it back, so it asks first.
    const user = userEvent.setup()
    renderBar([row("a"), row("b")], ["a", "b"])
    await user.click(
      await screen.findByRole("button", { name: "More actions" })
    )
    await user.click(
      await screen.findByRole("menuitem", { name: "No reply needed" })
    )
    const dialog = await screen.findByRole("alertdialog", {
      name: "Mark 2 reviews as no reply needed?",
    })
    expect(dialog).toHaveTextContent(
      "They leave Needs reply. Nothing is posted to Google."
    )
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Mark 2 reviews" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "mark_reviewed",
      reviewIds: ["a", "b"],
    })
  })

  it("sends nothing when No reply needed is cancelled", async () => {
    // Nothing approvable: No reply needed is the primary itself.
    const user = userEvent.setup()
    renderBar([row("a", { workflowStatus: "new", draftId: null })], ["a"])
    await user.click(
      await screen.findByRole("button", { name: "No reply needed" })
    )
    await user.click(await screen.findByRole("button", { name: "Cancel" }))
    expect(mutateAsync).not.toHaveBeenCalled()
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
    await user.click(
      screen.getByRole("button", { name: "Approve and publish 2" })
    )
    expect(await screen.findByText("Skipped")).toBeInTheDocument()
    // Named by who wrote it and where, not by an id.
    expect(screen.getByText("Sam · Girton")).toBeInTheDocument()
  })

  // An approval that was recorded is not "skipped": the decision stands even
  // when Google did not take the reply, or may have.
  it("names approved-but-unpublished and uncertain rows for what they are", async () => {
    mutateAsync.mockResolvedValueOnce({
      results: [
        {
          reviewId: "a",
          status: "approved_not_published",
          code: "review_changed",
        },
        {
          reviewId: "b",
          status: "uncertain",
          code: "google_mutation_ambiguous",
        },
      ],
    })
    const user = userEvent.setup()
    renderBar(
      [
        row("a"),
        row("b", {
          reviewer: {
            displayName: "Ana",
            isAnonymous: false,
            profilePhotoUrl: null,
          },
        }),
      ],
      ["a", "b"]
    )
    await user.click(await screen.findByRole("button", { name: /^Approve/ }))
    await user.click(
      screen.getByRole("button", { name: "Approve and publish 2" })
    )
    expect(
      await screen.findByText("Approved, not published")
    ).toBeInTheDocument()
    expect(screen.getByText("Check on Google")).toBeInTheDocument()
    expect(screen.queryByText("Skipped")).not.toBeInTheDocument()
    expect(
      await screen.findByText(
        "1 approved but not published, 1 may have reached Google"
      )
    ).toBeInTheDocument()
  })

  it("offers the rating template only when the selection has rating-only reviews", async () => {
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await user.click(
      await screen.findByRole("button", { name: "More actions" })
    )
    await screen.findByRole("menuitem", { name: "No reply needed" })
    expect(
      screen.queryByRole("menuitem", { name: "Reply with template" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Reply with template" })
    ).not.toBeInTheDocument()
  })

  it("opens the template batch for a rating-only selection", async () => {
    const user = userEvent.setup()
    renderBar(
      [row("a", { text: null, workflowStatus: "new", draftId: null })],
      ["a"]
    )
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(
      await screen.findByRole("dialog", {
        name: "Reply with the rating template",
      })
    ).toBeInTheDocument()
  })

  it("keeps the touch row to the count, the overflow and one primary", async () => {
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    const bar = await screen.findByRole("region", { name: "Selected reviews" })
    // Clear is the bar header's own 44px text button at every width, beside
    // "1 selected"; the tiles are only the overflow and one primary.
    const clearButton = within(bar).getByRole("button", {
      name: "Clear selection",
    })
    expect(clearButton).toHaveAttribute("data-slot", "selection-bar-cancel")
    expect(clearButton).toHaveClass("min-h-(--np-touch)", "min-w-(--np-touch)")
    expect(
      within(within(bar).getByRole("toolbar")).getAllByRole("button")
    ).toHaveLength(2)
    await user.click(clearButton)
    expect(
      screen.queryByRole("region", { name: "Selected reviews" })
    ).not.toBeInTheDocument()
  })

  // SelectionBar look: below md the overflow and the primary are 64px tiles,
  // an icon over a caption (inline buttons from md); the Approve that
  // publishes to Google is the charcoal tile; "N selected" stays in it.
  it("draws the phone's actions as 64px tiles, icon over label", async () => {
    renderBar([row("a")], ["a"])
    const bar = await screen.findByRole("region", { name: "Selected reviews" })
    expect(within(bar).getByText("1 selected")).toBeInTheDocument()
    expect(
      within(bar).getByRole("button", { name: "Approve 1" })
    ).toHaveAttribute("data-tone", "charcoal")
    expect(
      within(bar).getByRole("button", { name: "More actions" })
    ).toHaveAttribute("data-tone", "default")
    expect(
      within(bar).getByRole("button", { name: "Approve 1" })
    ).toHaveAttribute("data-slot", "selection-bar-tile")
    for (const name of ["Approve 1", "More actions"]) {
      const tile = within(bar).getByRole("button", { name })
      expect(tile).toHaveClass(
        "min-h-16",
        "min-w-16",
        "flex-col",
        "text-caption",
        "md:flex-row"
      )
      expect(tile.querySelector("svg")).not.toBeNull()
    }
    // The overflow tile's caption begins its accessible name (2.5.3).
    const more = within(bar).getByRole("button", { name: "More actions" })
    expect(more).toHaveTextContent("More")
  })

  it("lists the assignees in the phone's action sheet instead of a flyout", async () => {
    asPhone()
    const user = userEvent.setup()
    renderBar([row("a")], ["a"])
    await user.click(
      await screen.findByRole("button", { name: "More actions" })
    )
    expect(
      await screen.findByRole("menuitem", { name: "No reply needed" })
    ).toBeInTheDocument()
    // Clear is the bar's own button now, not repeated in the sheet.
    expect(
      screen.queryByRole("menuitem", { name: "Clear selection" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Assign…" })
    ).not.toBeInTheDocument()
    expect(screen.getByRole("group", { name: "Assign to" })).toBeInTheDocument()
    screen.getByRole("menuitem", { name: "Priya" }).focus()
    await user.keyboard("{Enter}")
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "assign",
      reviewIds: ["a"],
      assigneeId: "u1",
    })
  })
})
