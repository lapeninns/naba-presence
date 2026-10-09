import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { TemplateReplyDialog } from "@/components/inbox/template-reply-dialog"
import { ApiClientError } from "@/lib/api/client"
import type { ReviewRow } from "@/lib/contracts/reviews"

const generateOrSaveDraft = vi.fn()
const publishReview = vi.fn()

vi.mock("@/lib/api/drafts", () => ({
  generateOrSaveDraft: (...args: unknown[]) => generateOrSaveDraft(...args),
}))
vi.mock("@/lib/api/publish", () => ({
  publishReview: (...args: unknown[]) => publishReview(...args),
}))

function row(id: string, overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id,
    location: {
      id: "l1",
      name: "Girton",
      clientId: "c1",
      clientName: "Old Crown",
    },
    reviewer: {
      displayName: `Guest ${id}`,
      isAnonymous: false,
      profilePhotoUrl: null,
    },
    rating: 5,
    text: null,
    detectedLanguageCode: null,
    languageConfidence: null,
    createTime: "2026-09-01T10:00:00.000Z",
    updateTime: `2026-09-01T10:00:0${id.length}.000Z`,
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
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

function draftFor(id: string, verdict = "pass") {
  return {
    draftId: `draft-${id}`,
    body: "Thanks",
    bodyBytes: 6,
    evidenceHash: null,
    verification: { id: `v-${id}`, verdict, reasons: [] },
  }
}

function renderDialog(rows: ReviewRow[]) {
  const onFinished = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <QueryClientProvider client={new QueryClient()}>
      <TemplateReplyDialog
        open
        rows={rows}
        onOpenChange={onOpenChange}
        onFinished={onFinished}
      />
    </QueryClientProvider>
  )
  return { onFinished, onOpenChange }
}

beforeEach(() => {
  generateOrSaveDraft.mockImplementation(async (id: string) => draftFor(id))
  publishReview.mockImplementation(async () => ({
    reviewReplyId: "rr",
    publishAttemptId: "pa",
    status: "published",
    googleReplyState: null,
  }))
})

afterEach(() => vi.clearAllMocks())

describe("TemplateReplyDialog", () => {
  it("previews the replies and lists what it leaves out", async () => {
    const user = userEvent.setup()
    renderDialog([
      row("a"),
      row("b", { text: "Lovely Sunday roast" }),
      row("c", { rating: 1 }),
    ])
    expect(screen.getByText(/of\s+3\s+selected/)).toBeInTheDocument()
    // The preview greets a real reviewer from the selection.
    expect(screen.getByText(/Hi Guest a,/)).toBeInTheDocument()
    await user.click(screen.getByText("2 selected are left out"))
    expect(screen.getByText(/needs a personal reply/)).toBeInTheDocument()
    expect(screen.getByText(/left for a personal reply/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Create 1 draft" })).toBeEnabled()

    await user.click(
      screen.getByRole("checkbox", { name: "Include 1–2 star ratings" })
    )
    expect(
      screen.getByRole("button", { name: "Create 2 drafts" })
    ).toBeEnabled()
  })

  it("drafts through the single-reply route, then publishes after a second step", async () => {
    const user = userEvent.setup()
    const { onFinished } = renderDialog([row("a"), row("bb")])

    await user.click(screen.getByRole("button", { name: "Create 2 drafts" }))
    await screen.findByText(/drafts are checked and ready/)
    expect(generateOrSaveDraft).toHaveBeenCalledTimes(2)
    expect(generateOrSaveDraft).toHaveBeenCalledWith("a", {})
    // Nothing is published until the operator asks.
    expect(publishReview).not.toHaveBeenCalled()

    await user.click(
      screen.getByRole("button", { name: "Publish 2 to Google" })
    )
    await screen.findByText(/2 sent to Google/)
    expect(publishReview).toHaveBeenCalledWith("a", {
      draftId: "draft-a",
      expectedReviewUpdateTime: "2026-09-01T10:00:01.000Z",
    })

    await user.click(screen.getByRole("button", { name: "Done" }))
    expect(onFinished).toHaveBeenCalledWith(["a", "bb"])
  })

  it("holds back drafts that fail their checks", async () => {
    const user = userEvent.setup()
    generateOrSaveDraft.mockImplementation(async (id: string) =>
      draftFor(id, id === "b" ? "fail" : "pass")
    )
    renderDialog([row("a"), row("b")])
    await user.click(screen.getByRole("button", { name: "Create 2 drafts" }))
    await screen.findByText(/draft is checked and ready/)
    expect(screen.getByText(/didn't pass its checks/)).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Publish 1 to Google" })
    ).toBeEnabled()
  })

  it("says Submit for approval when the operator can't publish", async () => {
    const user = userEvent.setup()
    publishReview.mockResolvedValue({
      reviewReplyId: "rr",
      publishAttemptId: "pa",
      status: "awaiting_approval",
      googleReplyState: null,
    })
    renderDialog([
      row("a", {
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      }),
    ])
    await user.click(screen.getByRole("button", { name: "Create 1 draft" }))
    await user.click(
      await screen.findByRole("button", { name: "Submit 1 for approval" })
    )
    await screen.findByText(/1 submitted for approval/)
  })

  it("stops the whole batch when publishing is paused", async () => {
    const user = userEvent.setup()
    publishReview.mockRejectedValue(
      new ApiClientError(
        503,
        "publishing_paused",
        "Publishing is temporarily paused."
      )
    )
    renderDialog([row("a"), row("b"), row("c"), row("d")])
    await user.click(screen.getByRole("button", { name: "Create 4 drafts" }))
    await user.click(
      await screen.findByRole("button", { name: "Publish 4 to Google" })
    )
    await screen.findByText(/Stopped:/)
    await waitFor(() =>
      expect(screen.getByText(/Nothing was sent/)).toBeInTheDocument()
    )
    // Two lanes were in flight when the pause came back; nothing new started.
    expect(publishReview.mock.calls.length).toBeLessThanOrEqual(2)
  })
})
