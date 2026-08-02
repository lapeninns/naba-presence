import { fireEvent, render, screen, waitFor } from "@testing-library/react"
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

// Resolve a realistic DraftResult so runGenerate/onSave can read result.body /
// result.verification without throwing.
const DRAFT_RESULT = {
  draftId: "d-new",
  body: "Generated reply body",
  bodyBytes: 20,
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
  it("labels the generate button 'Generate draft' when there is no draft yet", () => {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation())
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    expect(screen.getByRole("button", { name: "Generate draft" })).toBeInTheDocument()
  })

  it("labels it 'Regenerate' once a draft exists and seeds the textbox", () => {
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "ai",
            body: "Existing draft body",
            bodyBytes: 19,
            evidenceHash: "h",
            modelName: "gpt",
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
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Existing draft body"
    )
  })

  it("enables Save draft only after an edit and posts the edited body", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "ai", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
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
    expect(mutateAsync).toHaveBeenCalledWith({ body: "Edited reply body" })
  })

  it("disables Save draft when the edit is over the 4096-byte limit", () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "ai", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
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

  it("confirms before regenerating over unsaved edits", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({ workflowStatus: "drafted", drafts: [
        { id: "d1", source: "ai", body: "Seed", bodyBytes: 4, evidenceHash: "h", modelName: "m", verificationStatus: "pass", createdAt: "2026-07-30T10:05:00.000Z" },
      ] }),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(mockMutation(mutateAsync))
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Toaster>
        <ReplyComposer reviewId="rev-1" />
      </Toaster>
    )
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), " extra")
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    // A confirm dialog appears; the regenerate has NOT fired yet.
    expect(
      screen.getByRole("alertdialog", { name: /Discard your edits/ })
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Discard and regenerate" }))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    )
  })
})
