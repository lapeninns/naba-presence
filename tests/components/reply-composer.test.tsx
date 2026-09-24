import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  DirtyGuardProvider,
  useComposerSave,
} from "@/components/inbox/dirty-context"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import { REPLY_FOCUS_EVENT, REPLY_GENERATE_EVENT } from "@/lib/inbox/events"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"

function reviewWith(
  overrides: Partial<ReviewDetail["review"]> = {}
): ReviewDetail {
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

// The composer asks its host for the discard confirmation rather than owning
// one, and outside a provider that host is `window.confirm` — which no test
// can answer "keep editing" to. Mounting the real DirtyGuardProvider gives the
// close-editor guard the same AlertDialog it has in the inbox.
function Host({ children }: { children: ReactNode }) {
  return (
    <Toaster>
      <DirtyGuardProvider>{children}</DirtyGuardProvider>
    </Toaster>
  )
}

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
})
afterEach(() => vi.restoreAllMocks())

describe("ReplyComposer", () => {
  it("offers a draft in each tone, without auto-calling the mutation on mount", () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    const tones = screen.getByRole("group", { name: "Start from a tone" })
    for (const name of ["Warm draft", "Concise draft", "Empathetic draft"]) {
      expect(within(tones).getByRole("button", { name })).toBeInTheDocument()
    }
    expect(
      screen.getByRole("button", { name: "Write my own reply" })
    ).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  // Preview exists so a saved reply can be READ before anything asks the
  // operator to change it. With no draft and no live reply there is nothing to
  // read, so the pane offers the two ways to start instead: a tone, or the
  // empty editor.
  it("opens the empty editor from 'Write my own reply', with a way back", async () => {
    const user = userEvent.setup()
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation()
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Write my own reply" }))
    const textbox = screen.getByRole("textbox", { name: "Your reply" })
    expect(textbox).toHaveValue("")
    expect(textbox).toHaveAttribute(
      "placeholder",
      "Write a reply, or generate one to start."
    )
    expect(screen.getByLabelText("Reply tone")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Edit reply" })
    ).not.toBeInTheDocument()
    // No saved reply to close back to, so the way out is back to the tones.
    expect(
      screen.queryByRole("button", { name: "Close editor" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Start from a tone" }))
    expect(
      screen.getByRole("group", { name: "Start from a tone" })
    ).toBeInTheDocument()
  })

  it("posts the chosen tone without a body when a tone card is clicked", async () => {
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
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    await user.click(screen.getByRole("button", { name: "Concise draft" }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "concise" })
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
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    // Regenerate is offered from the preview as well, so the label is right
    // before the operator has opened the editor at all.
    expect(
      screen.getByRole("button", { name: "Regenerate" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(
      screen.getByRole("textbox", { name: "Your reply" }),
      " edits"
    )
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole("button", { name: "Discard and regenerate" })
    )
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
  })

  it("seeds the textbox from an existing draft", async () => {
    const user = userEvent.setup()
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
      mockMutation()
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Existing draft body"
    )
    expect(
      screen.getByRole("button", { name: "Re-run checks" })
    ).toBeInTheDocument()
  })

  it("enables Save draft only after an edit and posts the edited body", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "human",
            body: "Seed",
            bodyBytes: 4,
            evidenceHash: "h",
            modelName: null,
            verificationStatus: "pass",
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
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
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

  it("disables Save draft when the edit is over the 4096-byte limit", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          {
            id: "d1",
            source: "human",
            body: "Seed",
            bodyBytes: 4,
            evidenceHash: "h",
            modelName: null,
            verificationStatus: "pass",
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
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    const textbox = screen.getByRole("textbox", { name: "Your reply" })
    // fireEvent, not userEvent.type: 4097 keystrokes would be needlessly slow
    // for what is purely a byte-count boundary check.
    fireEvent.change(textbox, { target: { value: "a".repeat(4097) } })
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
  })

  // A reply that is live on Google with no newer draft waiting for it. There
  // is nothing left to write, so the pane's question is "is this reply right?"
  // — which readable text answers and a textarea does not.
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
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation()
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
  }

  it("shows a settled reply as readable text, with the editor only a click away", async () => {
    const user = userEvent.setup()
    renderSettled()
    expect(
      screen.getByRole("heading", { name: "Published reply", level: 3 })
    ).toBeInTheDocument()
    expect(screen.getByText("Thanks for the kind words!")).toBeInTheDocument()
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Regenerate" })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
      "Thanks for the kind words!"
    )
    expect(screen.getByText("In sync with Google")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save draft" })).toBeDisabled()
  })

  it("drops the in-sync note the moment the text diverges", async () => {
    const user = userEvent.setup()
    renderSettled()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(
      screen.getByRole("textbox", { name: "Your reply" }),
      " Really."
    )
    expect(screen.queryByText("In sync with Google")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Save draft" })).toBeEnabled()
  })

  it("returns to the preview when the editor is closed with nothing unsaved", async () => {
    const user = userEvent.setup()
    renderSettled()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.click(screen.getByRole("button", { name: "Close editor" }))
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Edit reply" })
    ).toBeInTheDocument()
  })

  // Closing the editor throws the unsaved words away, so it goes through the
  // same guard as navigating away from them does.
  it("asks before closing the editor on unsaved edits, and Keep editing keeps both", async () => {
    const user = userEvent.setup()
    renderSettled()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(
      screen.getByRole("textbox", { name: "Your reply" }),
      " Really."
    )
    await user.click(screen.getByRole("button", { name: "Close editor" }))
    expect(await screen.findByRole("alertdialog")).toHaveTextContent(
      "Discard unsaved reply?"
    )
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveValue(
        "Thanks for the kind words! Really."
      )
    })
  })

  // `r` asks the composer to open; the composer decides. The hotkey layer
  // knows nothing about this review's permissions and must not be able to
  // talk the editor open past them.
  it("opens and focuses the editor when the focus-reply event asks", async () => {
    renderSettled()
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Your reply" })).toHaveFocus()
    })
  })

  it("ignores the focus-reply event when the operator may not edit", async () => {
    renderSettled({
      capabilities: {
        canPublish: false,
        canEdit: false,
        canRequestApproval: false,
      },
    })
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await waitFor(() => {
      expect(
        screen.getByText(
          "You can read this reply, but you do not have permission to edit it."
        )
      ).toBeInTheDocument()
    })
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
  })

  // Who wrote the words matters when they are about to go on a public profile
  // under the business's name.
  it("says who wrote the draft, and flags unsaved edits", async () => {
    const user = userEvent.setup()
    renderSettled()
    expect(screen.getByText("Drafted by AI")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), "!")
    expect(
      screen.getByText("Drafted by AI · unsaved edits")
    ).toBeInTheDocument()
  })

  it("labels a hand-written draft as written by you", async () => {
    const user = userEvent.setup()
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
    // The draft has moved on from what is live, so this is not the published
    // reply — and once open, the editor does not claim to be in sync either.
    expect(
      screen.getByRole("heading", { name: "Your reply", level: 3 })
    ).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    expect(screen.queryByText("In sync with Google")).not.toBeInTheDocument()
  })
})

// The publish bar's "Save & check" runs the composer's own save — the same
// call Save draft and ⌘↵ make — through the dirty store.
function SaveProbe() {
  const save = useComposerSave()
  return save ? (
    <button
      type="button"
      disabled={save.blockedReason !== null}
      onClick={save.save}
    >
      Probe save
    </button>
  ) : null
}

describe("ReplyComposer — shared save and first draft", () => {
  function draftedReview() {
    return reviewWith({
      workflowStatus: "drafted",
      drafts: [
        {
          id: "d1",
          source: "human",
          body: "Seed",
          bodyBytes: 4,
          evidenceHash: "h",
          modelName: null,
          verificationStatus: "pass",
          createdAt: "2026-07-30T10:05:00.000Z",
        },
      ],
    })
  }

  it("offers its save to the publish bar only while there are edits", async () => {
    const user = userEvent.setup()
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: draftedReview(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
        <SaveProbe />
      </Host>
    )
    expect(
      screen.queryByRole("button", { name: "Probe save" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.type(screen.getByRole("textbox", { name: "Your reply" }), "!")
    await user.click(screen.getByRole("button", { name: "Probe save" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      body: "Seed!",
      tone: "warm_professional",
    })
  })

  it("says the text cannot be saved while it is empty", async () => {
    const user = userEvent.setup()
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: draftedReview(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation()
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
        <SaveProbe />
      </Host>
    )
    await user.click(screen.getByRole("button", { name: "Edit reply" }))
    await user.clear(screen.getByRole("textbox", { name: "Your reply" }))
    expect(screen.getByRole("button", { name: "Probe save" })).toBeDisabled()
  })

  it("generates a first draft in the default tone when `g` asks", async () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: reviewWith(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    fireEvent(window, new Event(REPLY_GENERATE_EVENT))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    )
  })

  it("leaves an existing draft alone when `g` asks", () => {
    const mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      data: draftedReview(),
    } as UseQueryResult<ReviewDetail>)
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation(mutateAsync)
    )
    vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
    render(
      <Host>
        <ReplyComposer reviewId="rev-1" />
      </Host>
    )
    fireEvent(window, new Event(REPLY_GENERATE_EVENT))
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
