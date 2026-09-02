import { fireEvent, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReplyComposer } from "@/components/inbox/reply-composer"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"

function reviewWith(overrides: Partial<ReviewDetail["review"]> = {}): ReviewDetail {
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
      workflowStatus: "new",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [],
      reply: null,
      timeline: [],
      capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
      latestVerification: null,
      ...overrides,
    },
  }
}

const DRAFT_RESULT = {
  draftId: "d-new",
  body: "Saved reply body",
  bodyBytes: 16,
  evidenceHash: "h",
  verification: { id: "v-new", verdict: "pass" as const, reasons: [] },
}

// `MutateOptions.onSuccess(data, variables, ...)` puts TData and TVariables
// on both sides of the mutate function's variance at once (TVariables is
// directly contravariant via `mutate(variables)` but also appears inside the
// contravariant `options` parameter's own callback, which flips it back to
// covariant) — no single concrete type satisfies both directions for both
// call sites (DraftInput/string) at once, so `any` is the only instantiation
// that is assignable to both useGenerateOrSaveDraft's and useVerifyDraft's
// exact mutation-result types (verified against `never`/`unknown`, which tsc
// rejects here). The eslint-disable is scoped to this one generic pair only.
function mockMutation(mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: false,
    isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see comment above
  } as unknown as UseMutationResult<any, Error, any>
}

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe("ReplyComposer", () => {
  it("offers manual Generate draft and tone, without auto-calling the mutation on mount", () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeInTheDocument()
    expect(screen.getByLabelText("Reply tone")).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveAttribute(
      "placeholder",
      "Write a reply, or generate one to start."
    )
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("posts tone without a body when Generate draft is clicked", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      ...DRAFT_RESULT,
      body: "AI drafted reply",
    })
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    await user.click(screen.getByRole("button", { name: "Generate draft" }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("body")
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "AI drafted reply"
    )
  })

  it("labels Regenerate when a draft already exists and confirms before replacing dirty edits", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue({
      ...DRAFT_RESULT,
      body: "Fresh AI draft",
    })
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "human",
            body: "Existing draft body",
            bodyBytes: 19,
            evidenceHash: "h",
            modelName: null,
            verificationStatus: "warn",
            createdAt: "2026-07-30T10:05:00.000Z",
          },
        ],
      }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), " edits")
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Discard and regenerate" }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
  })

  it("seeds the textbox from an existing draft", () => {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "human",
            body: "Existing draft body",
            bodyBytes: 19,
            evidenceHash: "h",
            modelName: null,
            verificationStatus: "warn",
            createdAt: "2026-07-30T10:05:00.000Z",
          },
        ],
      }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Existing draft body"
    )
    expect(screen.getByRole("button", { name: "Re-verify" })).toBeInTheDocument()
  })

  it("enables Save draft only after an edit and posts the edited body", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "human", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: null, verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ] }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation(mutateAsync))
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
    const textbox = screen.getByRole("textbox", { name: "Your reply" })
    await user.clear(textbox)
    await user.type(textbox, "Edited reply body")
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
    await user.click(screen.getByRole("button", { name: "Save draft" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      body: "Edited reply body",
      tone: "warm_professional",
    })
  })

  it("disables Save draft when the edit is over the 4096-byte limit", () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "human", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: null, verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ] }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation(mutateAsync))
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    const textbox = screen.getByRole("textbox", { name: "Your reply" })
    // fireEvent, not userEvent.type: 4097 keystrokes would be needlessly slow
    // for what is purely a byte-count boundary check.
    fireEvent.change(textbox, { target: { value: "a".repeat(4097) } })
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
  })

  // The old pane rendered the live reply and an identical draft as two full
  // blocks of the same text. The composer now edits the live words directly,
  // so there is only ever one copy on screen.
  const SETTLED = {
    workflowStatus: "published",
    reply: {
      id: "reply-1",
      body: "Thanks for the kind words!",
      publishStatus: "published",
      googleReplyState: "APPROVED",
      googlePolicyViolation: null,
      googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
    },
    drafts: [
      {
        id: "d1",
        source: "ai",
        body: "Thanks for the kind words!",
        bodyBytes: 26,
        evidenceHash: "h",
        modelName: "m",
        verificationStatus: "pass",
        createdAt: "2026-07-30T10:05:00.000Z",
      },
    ],
  } satisfies Partial<ReviewDetail["review"]>

  function renderSettled(overrides: Partial<ReviewDetail["review"]> = {}) {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ ...SETTLED, ...overrides }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
  }

  it("edits the live reply in place, with nothing to save until it changes", async () => {
    const user = userEvent.setup()
    renderSettled()
    expect(screen.getByText("Thanks for the kind words!")).toBeInTheDocument()
    expect(screen.queryByRole("textbox", { name: "Your reply" })).not.toBeInTheDocument()
    expect(screen.getByText("In sync with Google")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Thanks for the kind words!"
    )
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
  })

  it("drops the in-sync note the moment the text diverges", async () => {
    const user = userEvent.setup()
    renderSettled()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), " Really.")
    expect(screen.queryByText("In sync with Google")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
  })

  // Who wrote the words matters when they are about to go on a public profile
  // under the business's name.
  it("says who wrote the draft, and flags unsaved edits", async () => {
    const user = userEvent.setup()
    renderSettled()
    expect(screen.getByText("Drafted by AI")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), "!")
    expect(screen.getByText("Drafted by AI · unsaved edits")).toBeInTheDocument()
  })

  it("labels a hand-written draft as written by you", () => {
    renderSettled({
      drafts: [
        {
          id: "d2",
          source: "human",
          body: "Thanks so much for the kind words!",
          bodyBytes: 34,
          evidenceHash: "h",
          modelName: null,
          verificationStatus: "pass",
          createdAt: "2026-07-30T12:00:00.000Z",
        },
      ],
    })
    expect(screen.getByText("Written by you")).toBeInTheDocument()
    // The draft has moved on from what is live, so it is not in sync.
    expect(screen.queryByText("In sync with Google")).not.toBeInTheDocument()
  })
})
