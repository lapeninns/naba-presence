import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar } from "@/components/inbox/action-bar"
import {
  DirtyGuardProvider,
  useRegisterDirtyGuard,
  type ComposerSave,
} from "@/components/inbox/dirty-context"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import { Toaster } from "@/components/ui/toast"
import { ApiClientError } from "@/lib/api/client"
import type { ReviewDetail } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as publishHook from "@/lib/queries/use-publish-review"
import * as approvalHook from "@/lib/queries/use-approval-decision"
import * as deleteHook from "@/lib/queries/use-delete-reply"
import * as draftHook from "@/lib/queries/use-draft-mutations"
import { PRIMARY_ACTION_EVENT, PUBLISH_PULSE_EVENT } from "@/lib/inbox/events"

function detailWith(overrides: Partial<ReviewDetail["review"]>): ReviewDetail {
  return {
    review: {
      id: "rev-1",
      reviewerDisplayName: "Sam",
      reviewerIsAnonymous: false,
      reviewerProfilePhotoUrl: null,
      rating: 4,
      text: "Nice",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z",
      updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false,
      workflowStatus: "verified",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [
        {
          id: "d1",
          source: "ai",
          body: "Reply",
          bodyBytes: 5,
          evidenceHash: "h",
          modelName: "m",
          verificationStatus: "pass",
          createdAt: "2026-07-30T10:05:00.000Z",
        },
      ],
      reply: null,
      timeline: [],
      capabilities: {
        canPublish: true,
        canEdit: true,
        canRequestApproval: false,
      },
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
function mutation(
  mutateAsync = vi.fn().mockResolvedValue({ status: "published" })
) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  } as unknown as UseMutationResult<any, Error, any>
}

afterEach(() => vi.restoreAllMocks())

// The composer's save as the bar sees it: resolves the NEW draft and its
// verdict.
function oneStepSave(verdict: "pass" | "warn" | "fail" = "pass"): ComposerSave {
  return {
    save: vi.fn().mockResolvedValue({
      draftId: "d2",
      verification: { id: "v2", verdict, reasons: [] },
    }),
    blockedReason: null,
    saving: false,
  }
}

function stubHooks(
  detail: ReviewDetail,
  publish = mutation(),
  approval = mutation(),
  del = mutation(),
  verify = mutation(
    vi
      .fn()
      .mockResolvedValue({
        verification: { id: "v9", verdict: "pass", reasons: [] },
      })
  ),
  refetched: ReviewDetail = detail
) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
    data: detail,
    refetch: vi.fn().mockResolvedValue({ data: refetched }),
  } as unknown as UseQueryResult<ReviewDetail>)
  vi.spyOn(publishHook, "usePublishReview").mockReturnValue(publish)
  vi.spyOn(approvalHook, "useApprovalDecision").mockReturnValue(approval)
  vi.spyOn(deleteHook, "useDeleteReply").mockReturnValue(del)
  vi.spyOn(draftHook, "useVerifyDraft").mockReturnValue(verify)
}

// ActionBar calls useToastManager() (needs a <Toaster> ancestor) and useIsDirty()
// (needs a DirtyGuardProvider). This host supplies both; `dirty` marks the
// composer dirty, and `save` is the save the composer offers the bar.
function DirtyStamp({ dirty, save }: { dirty: boolean; save?: ComposerSave }) {
  useRegisterDirtyGuard(dirty, async () => true, save)
  return null
}
function renderActionBar(dirty = false, save?: ComposerSave) {
  return render(
    <Toaster>
      <DirtyGuardProvider>
        <DirtyStamp dirty={dirty} save={save} />
        <ActionBar reviewId="rev-1" />
      </DirtyGuardProvider>
    </Toaster>
  )
}

describe("ActionBar", () => {
  // The review changed on Google after the reply was checked: publish answers
  // stale_draft_evidence. One press re-checks the same draft against the
  // review as it is now and, if it still passes, publishes once more.
  it("re-checks a stale draft and publishes it again when it still passes", async () => {
    const user = userEvent.setup()
    const publish = mutation(
      vi
        .fn()
        .mockRejectedValueOnce(
          new ApiClientError(409, "stale_draft_evidence", "x")
        )
        .mockResolvedValueOnce({ status: "published" })
    )
    const verify = mutation(
      vi
        .fn()
        .mockResolvedValue({
          verification: { id: "v9", verdict: "pass", reasons: [] },
        })
    )
    const fresh = detailWith({ updateTime: "2026-08-01T09:00:00.000Z" })
    stubHooks(detailWith({}), publish, mutation(), mutation(), verify, fresh)
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Publish reply" }))
    await waitFor(() => expect(publish.mutateAsync).toHaveBeenCalledTimes(2))
    expect(verify.mutateAsync).toHaveBeenCalledWith("d1")
    expect(publish.mutateAsync).toHaveBeenLastCalledWith({
      draftId: "d1",
      expectedReviewUpdateTime: "2026-08-01T09:00:00.000Z",
    })
  })

  it("does not publish a stale draft that fails the re-check", async () => {
    const user = userEvent.setup()
    const publish = mutation(
      vi
        .fn()
        .mockRejectedValue(new ApiClientError(409, "stale_draft_evidence", "x"))
    )
    const verify = mutation(
      vi
        .fn()
        .mockResolvedValue({
          verification: { id: "v9", verdict: "fail", reasons: [] },
        })
    )
    stubHooks(detailWith({}), publish, mutation(), mutation(), verify)
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Publish reply" }))
    expect(
      await screen.findByText(/no longer passes the checks/)
    ).toBeInTheDocument()
    expect(publish.mutateAsync).toHaveBeenCalledTimes(1)
  })

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

  it("disables Publish when the user cannot publish", () => {
    stubHooks(
      detailWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
      })
    )
    renderActionBar()
    expect(screen.getByRole("button", { name: "Publish reply" })).toBeDisabled()
  })

  it("keeps Publish off for unsaved edits the composer has not offered to save", () => {
    stubHooks(detailWith({}))
    renderActionBar(true)
    expect(screen.getByRole("button", { name: "Publish reply" })).toBeDisabled()
  })

  it("keeps Publish off, even with edits, when the user cannot publish", () => {
    stubHooks(
      detailWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
      })
    )
    renderActionBar(true, oneStepSave())
    expect(screen.getByRole("button", { name: "Publish reply" })).toBeDisabled()
  })

  // Sending refused words again unchanged is not a retry.
  it.each([
    ["google_timeout", "Retry publish"],
    ["INVALID_ARGUMENT", "Publish reply"],
  ])(
    "names the failed-publish button by its cause (%s)",
    (lastErrorCode, name) => {
      stubHooks(
        detailWith({
          workflowStatus: "failed",
          reply: {
            id: "reply-1",
            body: null,
            publishStatus: "failed",
            googleReplyState: null,
            googlePolicyViolation: null,
            googleReplyUpdatedAt: null,
            lastErrorCode,
          },
        })
      )
      renderActionBar()
      expect(screen.getByRole("button", { name })).toBeInTheDocument()
    }
  )

  // One press: save the text on screen (the drafts route checks what it
  // stores), then publish the draft that save returned — never an older one.
  it("saves, checks and publishes the edited text as the new draft in one press", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    const save = oneStepSave()
    stubHooks(detailWith({}), publish)
    renderActionBar(true, save)
    const button = screen.getByRole("button", { name: /Publish reply/ })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(save.save).toHaveBeenCalledTimes(1)
    expect(publish.mutateAsync).toHaveBeenCalledWith({
      draftId: "d2",
      expectedReviewUpdateTime: "2026-07-30T10:00:00.000Z",
    })
  })

  it("publishes a warned draft, since a warning does not block", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    stubHooks(detailWith({}), publish)
    renderActionBar(true, oneStepSave("warn"))
    await user.click(screen.getByRole("button", { name: /Publish reply/ }))
    expect(publish.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "d2" })
    )
  })

  it("does not publish when the check fails", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    const save = oneStepSave("fail")
    stubHooks(detailWith({}), publish)
    renderActionBar(true, save)
    await user.click(screen.getByRole("button", { name: /Publish reply/ }))
    expect(save.save).toHaveBeenCalledTimes(1)
    expect(publish.mutateAsync).not.toHaveBeenCalled()
  })

  it("does not publish when the save fails", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    const save: ComposerSave = {
      save: vi.fn().mockResolvedValue(null),
      blockedReason: null,
      saving: false,
    }
    stubHooks(detailWith({}), publish)
    renderActionBar(true, save)
    await user.click(screen.getByRole("button", { name: /Publish reply/ }))
    expect(save.save).toHaveBeenCalledTimes(1)
    expect(publish.mutateAsync).not.toHaveBeenCalled()
  })

  it("keeps Publish off, under its own name, when the text cannot be sent", () => {
    stubHooks(detailWith({}))
    renderActionBar(true, {
      ...oneStepSave(),
      blockedReason: "Write the reply before publishing it.",
    })
    expect(screen.getByRole("button", { name: /Publish reply/ })).toBeDisabled()
  })

  // The button says what it is doing, never a bare spinner.
  it("reads Checking… while the save runs", () => {
    stubHooks(detailWith({}))
    renderActionBar(true, { ...oneStepSave(), saving: true })
    const button = screen.getByRole("button", { name: /Checking…/ })
    expect(button).toHaveAttribute("aria-busy", "true")
  })

  it("keeps Approve for an approver whatever the composer holds", () => {
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }))
    renderActionBar(true, oneStepSave())
    expect(
      screen.getByRole("button", { name: "Approve reply" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Publish reply/ })
    ).not.toBeInTheDocument()
  })

  // `a` clicks the bar's main button, so it can never do what the button, as
  // it stands, would not.
  it("presses the main button when asked, and only when it is live", async () => {
    const publish = mutation()
    stubHooks(detailWith({}), publish)
    renderActionBar()
    window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT))
    await waitFor(() => expect(publish.mutateAsync).toHaveBeenCalledTimes(1))
  })

  it("ignores the request while the main button is off", () => {
    const publish = mutation()
    stubHooks(
      detailWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
      }),
      publish
    )
    renderActionBar()
    window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT))
    expect(publish.mutateAsync).not.toHaveBeenCalled()
  })

  // "Publish" is the wrong verb once something is already on Google.
  it("calls the primary 'Update reply' once a reply is live", () => {
    stubHooks(
      detailWith({
        drafts: [
          {
            id: "d1",
            source: "human",
            body: "Thanks so much!",
            bodyBytes: 15,
            evidenceHash: "h",
            modelName: null,
            verificationStatus: "pass",
            createdAt: "2026-07-30T12:00:00.000Z",
          },
        ],
        reply: {
          id: "reply-1",
          body: "Thanks!",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      })
    )
    renderActionBar()
    expect(screen.getByRole("button", { name: "Update reply" })).toBeEnabled()
    expect(
      screen.queryByRole("button", { name: "Publish reply" })
    ).not.toBeInTheDocument()
  })

  // Re-sending identical text is a pointless round-trip the domain has no
  // transition for. The button holds its place — the composer edits the live
  // words directly, so it comes back the moment they change.
  it("disables the primary when nothing differs from what is live", () => {
    stubHooks(
      detailWith({
        workflowStatus: "published",
        drafts: [
          {
            id: "d1",
            source: "ai",
            body: "Thanks!",
            bodyBytes: 7,
            evidenceHash: "h",
            modelName: "m",
            verificationStatus: "pass",
            createdAt: "2026-07-30T10:05:00.000Z",
          },
        ],
        reply: {
          id: "reply-1",
          body: "Thanks!",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      })
    )
    renderActionBar()
    expect(screen.getByRole("button", { name: "Update reply" })).toBeDisabled()
    // Delete is still reachable.
    expect(
      screen.getByRole("button", { name: "Review actions" })
    ).toBeInTheDocument()
  })

  // `replyWork` reads server state, so it still says "settled" while the
  // composer holds unsaved edits. The edited text is a change to send.
  it("updates a live reply in one press once the composer holds edits", async () => {
    const user = userEvent.setup()
    const publish = mutation()
    stubHooks(
      detailWith({
        workflowStatus: "published",
        drafts: [
          {
            id: "d1",
            source: "ai",
            body: "Thanks!",
            bodyBytes: 7,
            evidenceHash: "h",
            modelName: "m",
            verificationStatus: "pass",
            createdAt: "2026-07-30T10:05:00.000Z",
          },
        ],
        reply: {
          id: "reply-1",
          body: "Thanks!",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      }),
      publish
    )
    renderActionBar(true, oneStepSave())
    const button = screen.getByRole("button", { name: /Update reply/ })
    expect(button).toBeEnabled()
    await user.click(button)
    expect(publish.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "d2" })
    )
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
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
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
    await waitFor(() => {
      expect(screen.getByText("Submitted for approval")).toBeInTheDocument()
      expect(
        screen.getByText("It goes live on Google once a manager approves it.")
      ).toBeInTheDocument()
    })
  })

  it("does not offer Submit for approval when the org does not require approval", () => {
    stubHooks(
      detailWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: false,
        },
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
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      })
    )
    renderActionBar()
    expect(
      screen.getByRole("button", { name: "Submit for approval" })
    ).toBeDisabled()
  })

  it("saves, checks and submits the edited text in one press", async () => {
    const user = userEvent.setup()
    const publish = mutation(
      vi.fn().mockResolvedValue({ status: "awaiting_approval" })
    )
    stubHooks(
      detailWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      }),
      publish
    )
    renderActionBar(true, oneStepSave())
    await user.click(
      screen.getByRole("button", { name: /Submit for approval/ })
    )
    expect(publish.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ draftId: "d2" })
    )
  })

  it("shows Approve and Reject when awaiting approval", () => {
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }))
    renderActionBar()
    expect(
      screen.getByRole("button", { name: "Approve reply" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Reject reply" })
    ).toBeInTheDocument()
  })

  it("surfaces the second-approver copy on a 403", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi
        .fn()
        .mockRejectedValue(
          new ApiClientError(403, "second_approver_required", "x")
        )
    )
    stubHooks(
      detailWith({ workflowStatus: "awaiting_approval" }),
      mutation(),
      approval
    )
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
      expect(screen.getByText("Google declined this reply")).toBeInTheDocument()
    )
    expect(screen.queryByText("Reply published")).not.toBeInTheDocument()
  })

  // Google has a `pending` reply and nothing more can be done to it here, so
  // the inbox moves on exactly as it does for `published`; `rejected` stays.
  it.each([
    ["published", true, "Reply published"],
    ["pending", true, "Reply submitted"],
    ["rejected", false, "Google declined this reply"],
  ])(
    "announces a %s outcome to the inbox: %s",
    async (status, advances, toast) => {
      const user = userEvent.setup()
      const listener = vi.fn()
      window.addEventListener(PUBLISH_PULSE_EVENT, listener)
      stubHooks(detailWith({}), mutation(vi.fn().mockResolvedValue({ status })))
      renderActionBar()
      await user.click(screen.getByRole("button", { name: "Publish reply" }))
      await waitFor(() => expect(screen.getByText(toast)).toBeInTheDocument())
      window.removeEventListener(PUBLISH_PULSE_EVENT, listener)
      if (advances) {
        expect(listener).toHaveBeenCalledTimes(1)
        expect((listener.mock.calls[0][0] as CustomEvent).detail).toEqual({
          reviewId: "rev-1",
          status,
        })
      } else {
        expect(listener).not.toHaveBeenCalled()
      }
    }
  )

  // Fix-round-1 IMPORTANT #3: Reject reverts workflow_status to `drafted` and
  // clears approval_requested_by server-side, so it must be confirmed —
  // mirroring the Delete AlertDialog pattern — not fired directly on click.
  it("requires confirming before firing a reject decision", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi.fn().mockResolvedValue({ status: "returned_to_draft" })
    )
    stubHooks(
      detailWith({ workflowStatus: "awaiting_approval" }),
      mutation(),
      approval
    )
    renderActionBar()

    await user.click(screen.getByRole("button", { name: "Reject reply" }))
    expect(approval.mutateAsync).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Confirm reject" }))
    await waitFor(() => expect(approval.mutateAsync).toHaveBeenCalledTimes(1))
    expect(approval.mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ decision: "reject" })
    )
  })

  // Below md the bar has room for one button beside the status words, so
  // Reject moves into the ⋯ menu (the trigger shows only there) and opens the
  // same confirm; from md up it is the grey button beside Approve.
  it("puts Reject in the ⋯ menu on phones, behind the same confirm", async () => {
    const user = userEvent.setup()
    const approval = mutation(
      vi.fn().mockResolvedValue({ status: "returned_to_draft" })
    )
    stubHooks(
      detailWith({ workflowStatus: "awaiting_approval" }),
      mutation(),
      approval
    )
    renderActionBar()
    const inline = screen.getByRole("button", { name: "Reject reply" })
    expect(inline).toHaveClass("max-md:hidden")
    const more = screen.getByRole("button", { name: "Review actions" })
    expect(more).toHaveClass("md:hidden")
    await user.click(more)
    await user.click(
      await screen.findByRole("menuitem", { name: "Reject reply" })
    )
    expect(
      await screen.findByRole("alertdialog", { name: "Reject this reply?" })
    ).toBeInTheDocument()
    expect(approval.mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Confirm reject" }))
    await waitFor(() =>
      expect(approval.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ decision: "reject" })
      )
    )
  })

  // D4: these controls sit on the charcoal bar. One filled primary (the
  // accent), every other control the on-charcoal quiet button.
  it("draws its controls for the charcoal bar", () => {
    stubHooks(detailWith({ workflowStatus: "awaiting_approval" }))
    renderActionBar()
    expect(
      screen.getByRole("button", { name: "Approve reply" })
    ).toHaveAttribute("data-variant", "default")
    expect(
      screen.getByRole("button", { name: "Reject reply" })
    ).toHaveAttribute("data-variant", "ghost-dark")
    expect(
      screen.getByRole("button", { name: "Review actions" })
    ).toHaveAttribute("data-variant", "ghost-dark")
  })

  // D5: publishing is a Google write, so its toast states the outcome and
  // links to Google; it never offers Undo.
  it("links a published reply to Google and offers no Undo", async () => {
    const user = userEvent.setup()
    stubHooks(
      detailWith({
        googleReplyUrl: "https://search.google.com/local/reviews?r=1",
      })
    )
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Publish reply" }))
    expect(await screen.findByText("Reply published")).toBeInTheDocument()
    expect(screen.getByText("Live on Google.")).toBeInTheDocument()
    // A real link into a new tab that is told nothing, not a button.
    // The primitive tells a screen reader the link opens a new tab.
    const view = screen.getByRole("link", {
      name: "View on Google (opens in a new tab)",
    })
    expect(view).toHaveAttribute(
      "href",
      "https://search.google.com/local/reviews?r=1"
    )
    expect(view).toHaveAttribute("target", "_blank")
    expect(view.getAttribute("rel")?.split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"])
    )
    expect(
      screen.queryByRole("button", { name: /View on Google/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Undo" })
    ).not.toBeInTheDocument()
  })

  // The link's safety is the toast primitive's (isSafeToastHref): an unsafe
  // href from the API never becomes an anchor, and nothing else steps in.
  it("draws no View on Google for a link that is not https", async () => {
    const user = userEvent.setup()
    stubHooks(detailWith({ googleReplyUrl: "javascript:alert(1)" }))
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Publish reply" }))
    expect(await screen.findByText("Reply published")).toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: /View on Google/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /View on Google/ })
    ).not.toBeInTheDocument()
  })

  // One primary at the control height, sized to its words: never a
  // full-width slab, so the docked bar stays one row.
  it("draws one auto-width primary, with the key hint on desk only", () => {
    stubHooks(detailWith({}))
    renderActionBar(true, oneStepSave())
    const publish = screen.getByRole("button", { name: /Publish reply/ })
    expect(publish.className).not.toMatch(/flex-1|w-full|h-12/)
    const hint = publish.querySelector("kbd")
    expect(hint).toHaveClass("hidden", "desk:inline-flex")
  })

  // Fix-round-1 IMPORTANT #4: the Delete affordance's copy ("removes your
  // reply from Google") is only true once the reply is actually live on
  // Google (`publishStatus === "published"`) — not merely present, and not
  // during e.g. `awaiting_approval`.
  it("does not offer to delete a reply that isn't actually published yet", async () => {
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
    // The ⋯ menu is there for the phone's Reject, but holds no Delete.
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Review actions" }))
    expect(
      await screen.findByRole("menuitem", { name: "Reject reply" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("menuitem", { name: "Delete published reply" })
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

  // On a phone the ⋯ is the shared bottom action sheet: titled with the
  // trigger's name, Reject first, then a rule and the destructive row in the
  // danger ink.
  it("opens the phone's review actions as a titled sheet, delete last in danger", async () => {
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
    try {
      stubHooks(
        detailWith({
          workflowStatus: "awaiting_approval",
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
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Review actions" }))
      const sheet = await screen.findByRole("menu")
      const popup = sheet.closest('[data-slot="dropdown-menu-content"]')
      expect(popup).toHaveAttribute("data-presentation", "sheet")
      expect(
        popup?.querySelector('[data-slot="menu-sheet-title"]')
      ).toHaveTextContent("Review actions")
      const items = within(sheet).getAllByRole("menuitem")
      expect(items.map((item) => item.textContent)).toEqual([
        "Reject reply",
        "Delete published reply",
      ])
      expect(within(sheet).getByRole("separator")).toBeInTheDocument()
      expect(items[1]).toHaveClass("text-danger-ink")
    } finally {
      vi.unstubAllGlobals()
    }
  })

  // U2: onDelete must route through describeOutcomeToast(result.status) —
  // never the hardcoded "Published reply deleted" — so a never-live reply
  // ("cancelled") gets honest copy distinct from an actually-live one
  // ("deleted"), and neither falls to the default "status will update
  // shortly" copy.
  async function deleteReply(status: "deleted" | "cancelled") {
    const user = userEvent.setup()
    const del = mutation(vi.fn().mockResolvedValue({ status }))
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
      }),
      mutation(),
      mutation(),
      del
    )
    renderActionBar()
    await user.click(screen.getByRole("button", { name: "Review actions" }))
    const menuItem = await screen.findByRole("menuitem", {
      name: "Delete published reply",
    })
    await user.click(menuItem)
    await user.click(
      await screen.findByRole("button", { name: "Delete reply" })
    )
    return del
  }

  it("shows 'Reply deleted' when the delete resolves an actually-live reply removed", async () => {
    await deleteReply("deleted")
    await waitFor(() =>
      expect(screen.getByText("Reply deleted")).toBeInTheDocument()
    )
    expect(
      screen.queryByText("Reply submitted. Its status will update shortly.")
    ).not.toBeInTheDocument()
  })

  it("shows 'Draft reply removed' when the delete resolves a never-live reply", async () => {
    await deleteReply("cancelled")
    await waitFor(() =>
      expect(screen.getByText("Draft reply removed")).toBeInTheDocument()
    )
    expect(
      screen.queryByText("Reply submitted. Its status will update shortly.")
    ).not.toBeInTheDocument()
  })
})
