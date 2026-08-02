import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar } from "@/components/inbox/action-bar"
import {
  DirtyGuardProvider,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { ReviewDetail } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as publishHook from "@/lib/queries/use-publish-review"
import * as approvalHook from "@/lib/queries/use-approval-decision"
import * as deleteHook from "@/lib/queries/use-delete-reply"

function detailWith(overrides: Partial<ReviewDetail["review"]>): ReviewDetail {
  return {
    review: {
      id: "rev-1", reviewerDisplayName: "Sam", reviewerIsAnonymous: false,
      rating: 4, text: "Nice", detectedLanguageCode: "en", languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z", updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false, workflowStatus: "verified", locationId: "loc-1",
      locationName: "Riverside", timezone: "Europe/London", verified: true,
      media: [],
      drafts: [
        { id: "d1", source: "ai", body: "Reply", bodyBytes: 5, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ],
      reply: null, timeline: [], capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
      latestVerification: null,
      ...overrides,
    },
  }
}

// `any` here (not `never`, per the brief's literal draft) for the same reason
// as reply-composer.test.tsx's mockMutation: UseMutationResult's TData/
// TVariables sit in both a contravariant position (`mutate`'s parameter) and
// a covariant one (inside its own `onSuccess` callback type), and publish/
// approval/delete each have distinct TData/TVariables — no single concrete
// type satisfies all three call sites at once under strict mode; `any` is
// the only assignable instantiation.
function mutation(mutateAsync = vi.fn().mockResolvedValue({ status: "published" })) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  } as unknown as UseMutationResult<any, Error, any>
}

afterEach(() => vi.restoreAllMocks())

function stubHooks(detail: ReviewDetail, publish = mutation(), approval = mutation(), del = mutation()) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({ data: detail } as UseQueryResult<ReviewDetail>)
  vi.spyOn(publishHook, "usePublishReview").mockReturnValue(publish)
  vi.spyOn(approvalHook, "useApprovalDecision").mockReturnValue(approval)
  vi.spyOn(deleteHook, "useDeleteReply").mockReturnValue(del)
}

// ActionBar calls useToastManager() (needs a <Toaster> ancestor) and useIsDirty()
// (needs a DirtyGuardProvider). This host supplies both; `dirty` marks the
// composer dirty so Publish must disable with the save-first reason.
function DirtyStamp({ dirty }: { dirty: boolean }) {
  useRegisterDirtyGuard(dirty, () => true)
  return null
}
function renderActionBar(dirty = false) {
  return render(
    <Toaster>
      <DirtyGuardProvider>
        <DirtyStamp dirty={dirty} />
        <ActionBar reviewId="rev-1" />
      </DirtyGuardProvider>
    </Toaster>
  )
}

describe("ActionBar", () => {
  it("enables Publish for a verified, publishable, clean review and posts the draft id", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    stubHooks(detailWith({}), publish)
    renderActionBar()
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(publish.mutateAsync).toHaveBeenCalledWith({
      draftId: "d1",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
  })

  it("disables Publish with a reason when the user cannot publish", () => {
    stubHooks(
      detailWith({
        capabilities: { canPublish: false, canEdit: true, canRequestApproval: false },
      })
    )
    renderActionBar()
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringContaining("permission to publish"))
  })

  it("disables Publish with a save-first reason while the composer is dirty", () => {
    stubHooks(detailWith({}))
    renderActionBar(true)
    const button = screen.getByRole("button", { name: "Publish reply" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute("title", expect.stringContaining("Save your draft"))
  })

  // D2: a non-publisher in an approval-required org sees "Submit for
  // approval" in place of the disabled Publish button, and it reuses the
  // publish mutation (the server routes it to `awaiting_approval`).
  it("offers Submit for approval to a non-publisher in an approval-required org and routes to approval", async () => {
    const user = userEvent.setup()
    const publish = mutation(
      vi.fn().mockResolvedValue({ status: "awaiting_approval" })
    )
    stubHooks(
      detailWith({
        capabilities: { canPublish: false, canEdit: true, canRequestApproval: true },
      }),
      publish
    )
    renderActionBar()
    const button = screen.getByRole("button", { name: "Submit for approval" })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(publish.mutateAsync).toHaveBeenCalledWith({
      draftId: "d1",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
    await waitFor(() =>
      expect(
        screen.getByText("Reply submitted for approval.")
      ).toBeInTheDocument()
    )
  })

  it("does not offer Submit for approval when the org does not require approval", () => {
    stubHooks(
      detailWith({
        capabilities: { canPublish: false, canEdit: true, canRequestApproval: false },
      })
    )
    renderActionBar()
    expect(
      screen.queryByRole("button", { name: "Submit for approval" })
    ).not.toBeInTheDocument()
  })

  // R6: evaluateRequestApproval mirrors evaluatePublish's transition guard
  // because both share the same publish mutation. Without it, a status the
  // server no longer accepts as publish-requestable (e.g. an already
  // "published" review) would render an enabled button whose click 409s.
  it("disables Submit for approval when the status is not publish-requestable, even though canRequestApproval is true", () => {
    stubHooks(
      detailWith({
        workflowStatus: "published",
        capabilities: { canPublish: false, canEdit: true, canRequestApproval: true },
      })
    )
    renderActionBar()
    const button = screen.getByRole("button", { name: "Submit for approval" })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute(
      "title",
      expect.stringContaining("cannot be submitted for approval")
    )
  })

  it("shows Approve and Reject when awaiting approval", () => {
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }))
    renderActionBar()
    expect(screen.getByRole("button", { name: "Approve reply" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Reject reply" })).toBeInTheDocument()
  })

  it("surfaces the second-approver copy on a 403", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi.fn().mockRejectedValue(new ApiClientError(403, "second_approver_required", "x"))
    )
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }), mutation(), approval)
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Approve reply" }))
    await waitFor(() =>
      expect(
        screen.getByText("A different authorised user must approve this reply.")
      ).toBeInTheDocument()
    )
  })

  // Fix-round-1 CRITICAL #1: `executePublish` can resolve (HTTP 200, not a
  // thrown ApiClientError) with `status: "rejected"` when Google's moderation
  // declines the reply. That must never render as the "Reply published"
  // success toast.
  it("shows a non-success toast — never 'published' — when the resolved outcome is rejected", async () => {
    const user = userEvent.setup()
    const publish = mutation(vi.fn().mockResolvedValue({ status: "rejected" }))
    stubHooks(detailWith({}), publish)
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Publish reply" }))
    await waitFor(() =>
      expect(screen.getByText("Google declined this reply.")).toBeInTheDocument()
    )
    expect(screen.queryByText("Reply published")).not.toBeInTheDocument()
  })

  // Fix-round-1 IMPORTANT #3: Reject reverts workflow_status to `drafted` and
  // clears approval_requested_by server-side, so it must be confirmed —
  // mirroring the Delete AlertDialog pattern — not fired directly on click.
  it("requires confirming before firing a reject decision", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi.fn().mockResolvedValue({ status: "returned_to_draft" })
    )
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }), mutation(), approval)
    renderActionBar()

    await user.click(screen.getByRole("button", { name: "Reject reply" }))
    expect(approval.mutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Confirm reject" }))
    await waitFor(() => expect(approval.mutateAsync).toHaveBeenCalledTimes(1))
    expect(approval.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "reject" })
    )
  })

  // Fix-round-1 IMPORTANT #4: the Delete affordance's copy ("removes your
  // reply from Google") is only true once the reply is actually live on
  // Google (`publishStatus === "published"`) — not merely present, and not
  // during e.g. `awaiting_approval`.
  it("does not offer to delete a reply that isn't actually published yet", () => {
    stubHooks(
      detailWith({
        workflowStatus: "awaiting_approval",
        reply: {
          id: "reply-1",
          body: "Thanks for the feedback!",
          publishStatus: "awaiting_approval",
          googleReplyState: null,
          googlePolicyViolation: null,
          googleReplyUpdatedAt: null,
        },
      })
    )
    renderActionBar()
    expect(
      screen.queryByRole("button", { name: "Review actions" })
    ).not.toBeInTheDocument()
  })

  it("offers to delete a reply that is actually published on Google", () => {
    stubHooks(
      detailWith({
        reply: {
          id: "reply-1",
          body: "Thanks for the feedback!",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      })
    )
    renderActionBar()
    expect(
      screen.getByRole("button", { name: "Review actions" })
    ).toBeInTheDocument()
  })
})
