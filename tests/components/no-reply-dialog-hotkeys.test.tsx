import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar } from "@/components/inbox/action-bar"
import { DirtyGuardProvider } from "@/components/inbox/dirty-context"
import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { NoReplyNeededDialog } from "@/components/inbox/review-triage"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { PRIMARY_ACTION_EVENT } from "@/lib/inbox/events"
import * as approvalHook from "@/lib/queries/use-approval-decision"
import * as deleteHook from "@/lib/queries/use-delete-reply"
import * as draftHook from "@/lib/queries/use-draft-mutations"
import * as publishHook from "@/lib/queries/use-publish-review"
import * as detailHook from "@/lib/queries/use-review-detail"

// The real overlay, the real document-level hotkeys and the real action bar,
// with only the network (the mutations) stubbed: the `a` shortcut must never
// publish behind a modal question about triage.

const detail = {
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
  },
} as unknown as ReviewDetail

function mutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn().mockResolvedValue({ status: "published" }),
    isPending: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as in action-bar.test.tsx
  } as unknown as UseMutationResult<any, Error, any>
}

function setup({ dialogOpen }: { dialogOpen: boolean }) {
  const publish = mutation()
  const onConfirm = vi.fn()
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
    data: detail,
    refetch: vi.fn().mockResolvedValue({ data: detail }),
  } as unknown as UseQueryResult<ReviewDetail>)
  vi.spyOn(publishHook, "usePublishReview").mockReturnValue(publish)
  vi.spyOn(approvalHook, "useApprovalDecision").mockReturnValue(mutation())
  vi.spyOn(deleteHook, "useDeleteReply").mockReturnValue(mutation())
  vi.spyOn(draftHook, "useVerifyDraft").mockReturnValue(mutation())
  render(
    <Toaster>
      <DirtyGuardProvider>
        <InboxHotkeys
          handlers={{
            approve: () =>
              window.dispatchEvent(new Event(PRIMARY_ACTION_EVENT)),
          }}
        />
        <ActionBar reviewId="rev-1" />
        <NoReplyNeededDialog
          count={1}
          open={dialogOpen}
          onOpenChange={() => {}}
          pending={false}
          onConfirm={onConfirm}
        />
      </DirtyGuardProvider>
    </Toaster>
  )
  return { publish, onConfirm }
}

afterEach(() => vi.restoreAllMocks())

describe("a shortcut behind the No reply needed question", () => {
  it("does not publish when `a` is pressed with Cancel focused", async () => {
    const user = userEvent.setup()
    const { publish, onConfirm } = setup({ dialogOpen: true })
    const cancel = await screen.findByRole("button", { name: "Cancel" })
    cancel.focus()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.keyboard("a")
    // Let anything the key started run before asserting nothing did.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(publish.mutateAsync).not.toHaveBeenCalled()
    expect(onConfirm).not.toHaveBeenCalled()
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
  })

  it("still publishes on `a` when no overlay owns focus", async () => {
    const user = userEvent.setup()
    const { publish } = setup({ dialogOpen: false })
    await user.keyboard("a")
    await waitFor(() => expect(publish.mutateAsync).toHaveBeenCalledTimes(1))
  })
})
