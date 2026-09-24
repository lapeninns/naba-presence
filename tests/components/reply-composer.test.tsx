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
  type ComposerSaveResult,
} from "@/components/inbox/dirty-context"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import {
  PRIMARY_ACTION_EVENT,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
} from "@/lib/inbox/events"
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
// call sites at once, so `any` is the only instantiation assignable to
// useGenerateOrSaveDraft's exact mutation-result type (verified against
// `never`/`unknown`, which tsc rejects here). The eslint-disable is scoped to
// this one generic pair only.
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
// one, and outside a provider that host is `window.confirm`. Mounting the real
// DirtyGuardProvider gives it the same AlertDialog it has in the inbox, and
// the store the publish bar reads the composer's save from.
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

type Draft = ReviewDetail["review"]["drafts"][number]

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: "d1",
    source: "human",
    body: "Existing draft body",
    bodyBytes: 19,
    evidenceHash: "h",
    modelName: null,
    verificationStatus: "pass",
    createdAt: "2026-07-30T10:05:00.000Z",
    ...overrides,
  }
}

const EXISTING = {
  workflowStatus: "drafted",
  drafts: [draft()],
} satisfies Partial<ReviewDetail["review"]>

// A reply that is live on Google with no newer draft waiting for it.
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
    draft({ source: "ai", body: "Thanks for the kind words!", bodyBytes: 26 }),
  ],
} satisfies Partial<ReviewDetail["review"]>

let probeResult: Promise<ComposerSaveResult | null> | null = null

// The publish bar runs the composer's own save through the dirty store; this
// stands in for it.
function SaveProbe() {
  const save = useComposerSave()
  return save ? (
    <button
      type="button"
      disabled={save.blockedReason !== null}
      title={save.blockedReason ?? undefined}
      onClick={() => {
        probeResult = save.save()
      }}
    >
      Probe save
    </button>
  ) : null
}

function mount(
  overrides: Partial<ReviewDetail["review"]> = {},
  mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)
) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
    data: reviewWith(overrides),
  } as UseQueryResult<ReviewDetail>)
  vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
    mockMutation(mutateAsync)
  )
  render(
    <Host>
      <ReplyComposer reviewId="rev-1" />
      <SaveProbe />
    </Host>
  )
  return mutateAsync
}

const textbox = () => screen.getByRole("textbox", { name: "Your reply" })

describe("ReplyComposer — the editor", () => {
  it("opens as an empty editor with the tone and Generate, calling nothing on mount", () => {
    const mutateAsync = mount()
    expect(textbox()).toHaveValue("")
    expect(textbox()).toHaveAttribute(
      "placeholder",
      "Write a reply, or generate one below."
    )
    const tones = screen.getByRole("radiogroup", { name: "Reply tone" })
    for (const name of ["Warm", "Concise", "Empathetic"]) {
      expect(within(tones).getByRole("radio", { name })).toBeInTheDocument()
    }
    expect(
      within(tones).getByRole("radio", { name: "Warm" })
    ).toHaveAccessibleDescription(/Friendly and personal/)
    expect(
      screen.getByRole("button", { name: "Generate reply" })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Write my own/ })
    ).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("fills the box from Generate, in the chosen tone, without sending a body", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(
      {},
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "AI drafted reply" })
    )
    // With nothing in the box, a tone only sets what Generate will use.
    await user.click(screen.getByRole("radio", { name: "Concise" }))
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("button", { name: "Generate reply" }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "concise" })
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("body")
    expect(textbox()).toHaveValue("AI drafted reply")
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument()
  })

  it("seeds the box from an existing draft, editable", () => {
    mount(EXISTING)
    expect(textbox()).toHaveValue("Existing draft body")
    expect(textbox()).not.toHaveAttribute("readonly")
  })

  it("seeds the box from a live reply, editable in place", async () => {
    const user = userEvent.setup()
    mount(SETTLED)
    expect(textbox()).toHaveValue("Thanks for the kind words!")
    await user.type(textbox(), " Really.")
    expect(textbox()).toHaveValue("Thanks for the kind words! Really.")
  })

  it("confirms before Regenerate replaces unsaved text", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(
      EXISTING,
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "Fresh AI draft" })
    )
    await user.type(textbox(), " edits")
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole("button", { name: "Discard and regenerate" })
    )
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
  })

  it("regenerates in a tone chosen on the editor bar once there is a reply", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING)
    await user.click(screen.getByRole("radio", { name: "Empathetic" }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "empathetic" })
  })

  it("confirms before a tone change replaces unsaved edits", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING)
    await user.type(textbox(), "!")
    await user.click(screen.getByRole("radio", { name: "Concise" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(
      screen.getByRole("button", { name: "Discard and regenerate" })
    )
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "concise" })
  })

  it("offers Undo after regenerating over a saved draft, restoring it as an edit", async () => {
    const user = userEvent.setup()
    mount(
      EXISTING,
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "Fresh AI draft" })
    )
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    await user.click(await screen.findByRole("button", { name: "Undo" }))
    expect(textbox()).toHaveValue("Existing draft body")
  })

  it("says a failed generation where it happened, with Retry and Write my own", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(
      {},
      vi
        .fn()
        .mockRejectedValueOnce(new TypeError("offline"))
        .mockResolvedValueOnce(DRAFT_RESULT)
    )
    await user.click(screen.getByRole("button", { name: "Generate reply" }))
    const alert = await screen.findByRole("alert")
    expect(alert).toHaveTextContent("No reply was generated.")
    await user.click(within(alert).getByRole("button", { name: "Retry" }))
    expect(mutateAsync).toHaveBeenLastCalledWith({ tone: "warm_professional" })
    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    )
  })

  it("focuses the editor from a failed generation's Write my own", async () => {
    const user = userEvent.setup()
    mount({}, vi.fn().mockRejectedValue(new TypeError("offline")))
    await user.click(screen.getByRole("button", { name: "Generate reply" }))
    const alert = await screen.findByRole("alert")
    await user.click(within(alert).getByRole("button", { name: "Write my own" }))
    await waitFor(() => expect(textbox()).toHaveFocus())
  })

  // `r` asks the composer to focus; the composer decides. The hotkey layer
  // knows nothing about this review's permissions.
  it("focuses the editor when the focus-reply event asks", async () => {
    mount(SETTLED)
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await waitFor(() => expect(textbox()).toHaveFocus())
  })

  it("keeps the editor read-only, and unfocused, when the operator may not edit", async () => {
    mount({
      ...SETTLED,
      capabilities: {
        canPublish: false,
        canEdit: false,
        canRequestApproval: false,
      },
    })
    expect(textbox()).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(textbox()).not.toHaveFocus()
  })

  // ⌘/Ctrl+Enter does exactly what the publish bar's button does, by asking
  // the bar to press it — it does not save on its own.
  it("asks the publish bar to press its button on ⌘/Ctrl+Enter", async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(PRIMARY_ACTION_EVENT, listener)
    const mutateAsync = mount(EXISTING)
    await user.type(textbox(), "!")
    await user.keyboard("{Control>}{Enter}{/Control}")
    window.removeEventListener(PRIMARY_ACTION_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})

describe("ReplyComposer — checks and length", () => {
  const FAILED = {
    ...EXISTING,
    drafts: [draft({ verificationStatus: "fail" })],
    latestVerification: {
      verdict: "fail" as const,
      reasons: [
        {
          code: "unsupported_claim",
          severity: "fail" as const,
          message: "It promises a refund nobody offered.",
        },
      ],
    },
  }

  it("says a failed check under the editor and marks the box invalid", () => {
    mount(FAILED)
    const problem = screen.getByRole("alert")
    expect(problem).toHaveTextContent(
      "Can’t publish yet. It promises a refund nobody offered. Edit the reply and try again."
    )
    expect(textbox()).toHaveAttribute("aria-invalid", "true")
    expect(textbox()).toHaveAccessibleDescription(/Can’t publish yet/)
  })

  it("clears the failed check on the next input", async () => {
    const user = userEvent.setup()
    mount(FAILED)
    await user.type(textbox(), "!")
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(textbox()).not.toHaveAttribute("aria-invalid")
  })

  it("says a warning as one quiet line that does not block", () => {
    mount({
      ...EXISTING,
      drafts: [draft({ verificationStatus: "warn" })],
      latestVerification: {
        verdict: "warn",
        reasons: [
          { code: "tone", severity: "warn", message: "Reads a little stiff." },
        ],
      },
    })
    expect(screen.getByText("Reads a little stiff.")).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
    expect(textbox()).not.toHaveAttribute("aria-invalid")
  })

  it("says nothing about length until the reply reaches 80% of Google's limit", () => {
    mount(EXISTING)
    expect(screen.queryByText(/length limit/)).not.toBeInTheDocument()
    fireEvent.change(textbox(), { target: { value: "a".repeat(3200) } })
    expect(screen.queryByText(/length limit/)).not.toBeInTheDocument()
    fireEvent.change(textbox(), { target: { value: "a".repeat(3276) } })
    expect(
      screen.getByText(/^Nearly at Google's length limit/)
    ).toBeInTheDocument()
    fireEvent.change(textbox(), { target: { value: "a".repeat(4097) } })
    expect(screen.getByText(/^Over Google's length limit/)).toBeInTheDocument()
    expect(textbox()).toHaveAttribute("aria-invalid", "true")
  })
})

describe("ReplyComposer — the save Publish runs", () => {
  beforeEach(() => {
    probeResult = null
  })

  it("offers nothing for a clean, checked draft", () => {
    mount(EXISTING)
    expect(
      screen.queryByRole("button", { name: "Probe save" })
    ).not.toBeInTheDocument()
  })

  it("offers its save once there are edits, and hands back the new draft", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING)
    await user.type(textbox(), "!")
    await user.click(screen.getByRole("button", { name: "Probe save" }))
    expect(mutateAsync).toHaveBeenCalledWith({
      body: "Existing draft body!",
      tone: "warm_professional",
    })
    await expect(probeResult).resolves.toEqual({
      draftId: "d-new",
      verification: DRAFT_RESULT.verification,
    })
  })

  it("offers its save for a saved draft that was never checked", () => {
    mount({ ...EXISTING, drafts: [draft({ verificationStatus: null })] })
    expect(screen.getByRole("button", { name: "Probe save" })).toBeEnabled()
  })

  it("says the text cannot be sent while it is empty", async () => {
    const user = userEvent.setup()
    mount(EXISTING)
    await user.clear(textbox())
    const probe = screen.getByRole("button", { name: "Probe save" })
    expect(probe).toBeDisabled()
    expect(probe).toHaveAttribute("title", "Write the reply before publishing it.")
  })

  it("says the text cannot be sent while it is over Google's limit", () => {
    mount(EXISTING)
    fireEvent.change(textbox(), { target: { value: "a".repeat(4097) } })
    expect(screen.getByRole("button", { name: "Probe save" })).toBeDisabled()
  })

  it("shows a failed check from the save under the editor and focuses it", async () => {
    const user = userEvent.setup()
    mount(
      EXISTING,
      vi.fn().mockResolvedValue({
        ...DRAFT_RESULT,
        verification: {
          id: "v-new",
          verdict: "fail",
          reasons: [
            { code: "pii", severity: "fail", message: "It names a guest." },
          ],
        },
      })
    )
    await user.type(textbox(), "!")
    await user.click(screen.getByRole("button", { name: "Probe save" }))
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "It names a guest."
    )
    await waitFor(() => expect(textbox()).toHaveFocus())
    await expect(probeResult).resolves.toMatchObject({
      verification: { verdict: "fail" },
    })
  })

  it("resolves null, and says why, when the save fails", async () => {
    const user = userEvent.setup()
    mount(EXISTING, vi.fn().mockRejectedValue(new TypeError("offline")))
    await user.type(textbox(), "!")
    await user.click(screen.getByRole("button", { name: "Probe save" }))
    await expect(probeResult).resolves.toBeNull()
  })
})

describe("ReplyComposer — first draft on `g`", () => {
  it("generates a first draft in the chosen tone when `g` asks", async () => {
    const mutateAsync = mount()
    fireEvent(window, new Event(REPLY_GENERATE_EVENT))
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    )
  })

  it("leaves an existing draft alone when `g` asks", () => {
    const mutateAsync = mount(EXISTING)
    fireEvent(window, new Event(REPLY_GENERATE_EVENT))
    expect(mutateAsync).not.toHaveBeenCalled()
  })
})
