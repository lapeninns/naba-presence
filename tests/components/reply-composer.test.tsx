import {
  act,
  cleanup,
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
  useIsDirty,
  type ComposerSaveResult,
} from "@/components/inbox/dirty-context"
import { ReplyComposer } from "@/components/inbox/reply-composer"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail } from "@/lib/api/reviews"
import { __resetDraftSources, stashDraft } from "@/lib/api/draft-stash"
import { ApiClientError } from "@/lib/api/client"
import { draftKey } from "@/lib/editors/draft-key"
import {
  __resetLeaveGuardForTests,
  guardNavigation,
} from "@/lib/editors/use-leave-guard"
import {
  PRIMARY_ACTION_EVENT,
  REPLY_FOCUS_EVENT,
  REPLY_GENERATE_EVENT,
} from "@/lib/inbox/events"
import { REPLY_EDIT_EVENT, type ReplyEditDetail } from "@/lib/inbox/events"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"
import * as creditsHook from "@/lib/queries/use-ai-credits"
import type { AiCredits } from "@/lib/contracts/ai-credits"

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
// Set by a test that wants the mutation reported as in flight.
let generating = false
function mockMutation(mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT)) {
  return {
    mutate: vi.fn(),
    mutateAsync,
    isPending: generating,
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
  mutateAsync = vi.fn().mockResolvedValue(DRAFT_RESULT),
  credits?: Partial<AiCredits>
) {
  vi.spyOn(creditsHook, "useAiCredits").mockReturnValue({
    data: credits
      ? {
          used: 0,
          allowance: 200,
          remaining: 200,
          periodId: "00000000-0000-4000-8000-0000000000e1",
          periodKind: "pilot_month",
          periodStart: "2026-10-01T00:00:00.000Z",
          periodEnd: "2026-11-01T00:00:00.000Z",
          canUseAi: true,
          accessReason: "pilot",
          ...credits,
        }
      : undefined,
  } as UseQueryResult<AiCredits>)
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

// Generate is a menu: pressing it opens the tones, and picking one writes the
// reply in it. `button` is the trigger's name ("Generate reply" over an empty
// box, "Regenerate" over text).
async function generateIn(
  user: ReturnType<typeof userEvent.setup>,
  tone: "Warm" | "Concise" | "Empathetic" = "Warm",
  button: "Generate reply" | "Regenerate" = "Generate reply"
) {
  await user.click(screen.getByRole("button", { name: button }))
  await user.click(await screen.findByRole("menuitem", { name: RegExp(tone) }))
}

// Every value of the inbox's dirty flag that reached the screen, in order.
let dirtySeen: boolean[] = []
function DirtyProbe() {
  dirtySeen.push(useIsDirty())
  return null
}

describe("ReplyComposer — opening a review", () => {
  beforeEach(() => {
    dirtySeen = []
    __resetLeaveGuardForTests()
    window.history.replaceState(null, "", "/inbox?selected=rev-1")
  })
  afterEach(() => __resetLeaveGuardForTests())

  function mountProbed(data: () => ReviewDetail | undefined) {
    vi.spyOn(creditsHook, "useAiCredits").mockReturnValue({
      data: undefined,
    } as UseQueryResult<AiCredits>)
    vi.spyOn(detailHook, "useReviewDetail").mockImplementation(
      () => ({ data: data() }) as UseQueryResult<ReviewDetail>
    )
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation()
    )
    const tree = () => (
      <Host>
        <ReplyComposer reviewId="rev-1" />
        <DirtyProbe />
        <SaveProbe />
      </Host>
    )
    const view = render(tree())
    return { rerender: () => view.rerender(tree()) }
  }

  // W2-02: the box used to be filled by an effect, so the first commit held
  // an empty box beside a review with a reply — dirty. The leave guard armed
  // on it and pushed a history entry for every review opened, and Publish
  // flickered off.
  it("never reads dirty, nor adds a history entry, when the draft is already loaded", () => {
    const length = window.history.length
    mountProbed(() => reviewWith(EXISTING))
    expect(textbox()).toHaveValue("Existing draft body")
    expect(dirtySeen).not.toContain(true)
    expect(window.history.length).toBe(length)
    // A clean, checked draft offers Publish no save of its own.
    expect(
      screen.queryByRole("button", { name: "Probe save" })
    ).not.toBeInTheDocument()
  })

  it("never reads dirty when the review arrives after the composer mounts", () => {
    const length = window.history.length
    const detail: { data?: ReviewDetail } = {}
    const view = mountProbed(() => detail.data)
    detail.data = reviewWith(SETTLED)
    view.rerender()
    expect(textbox()).toHaveValue("Thanks for the kind words!")
    expect(dirtySeen).not.toContain(true)
    expect(window.history.length).toBe(length)
  })

  it("puts back a reply stashed by a forced sign-out, over the saved draft", async () => {
    stashDraft(
      draftKey({
        userId: null,
        organisationId: null,
        resource: "inbox-reply",
        resourceId: "rev-1",
        schemaVersion: 1,
      }),
      "My unsent words"
    )
    mountProbed(() => reviewWith(EXISTING))
    await waitFor(() => expect(textbox()).toHaveValue("My unsent words"))
    // A real unsaved edit: the guard is meant to arm for it.
    expect(dirtySeen.at(-1)).toBe(true)
  })

  // W2-07: the store's discard cleared the dirty flag, but the composer only
  // re-registered when its own dirtiness changed, and a composer still on
  // screen stays dirty. Edits made after that went unguarded.
  it("guards edits made after a leave-prompt Discard that kept the page", async () => {
    const user = userEvent.setup()
    mountProbed(() => reviewWith(EXISTING))
    await user.type(textbox(), " edited")
    expect(dirtySeen.at(-1)).toBe(true)

    // A held navigation that, once confirmed, does not leave the inbox.
    const run = vi.fn()
    act(() => guardNavigation(run))
    await user.click(
      within(
        await screen.findByRole("alertdialog", {
          name: "Discard unsaved reply?",
        })
      ).getByRole("button", { name: "Discard" })
    )
    expect(run).toHaveBeenCalledTimes(1)
    expect(dirtySeen.at(-1)).toBe(false)
    // Nothing of the given-up text is kept for a later restore.
    expect(sessionStorage.length).toBe(0)

    await user.type(textbox(), " again")
    await waitFor(() => expect(dirtySeen.at(-1)).toBe(true))
    // The next navigation asks again rather than running at once.
    const next = vi.fn()
    act(() => guardNavigation(next))
    expect(
      await screen.findByRole("alertdialog", {
        name: "Discard unsaved reply?",
      })
    ).toBeInTheDocument()
    expect(next).not.toHaveBeenCalled()
  })
})

describe("ReplyComposer — the editor", () => {
  it("opens as an empty editor with Generate beneath it, calling nothing on mount", () => {
    const mutateAsync = mount()
    expect(textbox()).toHaveValue("")
    expect(textbox()).toHaveAttribute(
      "placeholder",
      "Write a reply, or generate one."
    )
    expect(
      screen.getByRole("button", { name: "Generate reply" })
    ).toBeInTheDocument()
    // The tone is inside Generate, not a control of its own.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Write my own/ })
    ).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  // INB-16: nothing sits between the top of the reply and the words. What
  // acts on them (Generate) is under the box, where it cannot push it down.
  it("puts the text box first and Generate under it", () => {
    mount()
    const editor = document.querySelector<HTMLElement>(
      '[data-slot="reply-editor"]'
    )!
    expect(editor.firstElementChild).toBe(textbox())
    const bar = document.querySelector('[data-slot="composer-prompt-bar"]')
    expect(bar).not.toBeNull()
    expect(
      within(bar as HTMLElement).getByRole("button", { name: "Generate reply" })
    ).toBeInTheDocument()
    expect(
      textbox().compareDocumentPosition(bar!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("grows the box with the text", () => {
    mount()
    expect(textbox()).toHaveAttribute("data-autosize", "true")
  })

  it("hides the count and the guidance until there is text", () => {
    mount()
    expect(document.querySelector('[data-slot="char-count"]')).toBeNull()
    expect(screen.queryByRole("list", { name: "Reply guidance" })).toBeNull()
    expect(screen.queryByText("Good replies")).not.toBeInTheDocument()
    expect(textbox()).not.toHaveAccessibleDescription(/Under 1,000/)
  })

  it("ticks the reply guidance off as they type, without circles or blocking anything", async () => {
    const user = userEvent.setup()
    mount({ reviewerDisplayName: "Sam" })
    await user.type(textbox(), "Thanks.")
    const guidance = screen.getByRole("list", { name: "Reply guidance" })
    expect(screen.getByText("Good replies")).toBeVisible()
    expect(textbox()).toHaveAccessibleDescription(/Under 1,000 characters/)
    const length = within(guidance).getByText(/Under 1,000 characters/)
    // At 7 characters the length already holds; it never reads as failing.
    expect(length.closest("li")).toHaveAttribute("data-met", "true")
    const name = within(guidance).getByText(/Greets them by name/)
    expect(name.closest("li")).toHaveAttribute("data-met", "false")
    // Nothing is drawn as a hollow circle that could read as a radio button.
    expect(guidance.querySelector(".lucide-circle")).toBeNull()

    await user.type(textbox(), " Sam, thank you.")
    expect(name.closest("li")).toHaveAttribute("data-met", "true")

    await user.clear(textbox())
    expect(screen.queryByRole("list", { name: "Reply guidance" })).toBeNull()
  })

  it("fills the box from Generate, in the tone picked inside it, without sending a body", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(
      {},
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "AI drafted reply" })
    )
    // Opening Generate only shows the tones; nothing is written until one is
    // picked.
    await user.click(screen.getByRole("button", { name: "Generate reply" }))
    for (const name of ["Warm", "Concise", "Empathetic"]) {
      expect(
        await screen.findByRole("menuitem", { name: RegExp(name) })
      ).toBeInTheDocument()
    }
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole("menuitem", { name: /Concise/ }))
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "concise" })
    expect(mutateAsync.mock.calls[0][0]).not.toHaveProperty("body")
    expect(textbox()).toHaveValue("AI drafted reply")
    expect(
      screen.getByRole("button", { name: "Regenerate" })
    ).toBeInTheDocument()
  })

  it("describes each tone in its menu row", async () => {
    const user = userEvent.setup()
    mount()
    await user.click(screen.getByRole("button", { name: "Generate reply" }))
    expect(
      await screen.findByRole("menuitem", { name: /Warm/ })
    ).toHaveTextContent(/Friendly and personal/)
    expect(screen.getByRole("menuitem", { name: /Concise/ })).toHaveTextContent(
      /Two sentences/
    )
    expect(
      screen.getByRole("menuitem", { name: /Empathetic/ })
    ).toHaveTextContent(/Acknowledges how they felt/)
  })

  it("seeds the box from an existing draft, editable", () => {
    mount(EXISTING)
    expect(textbox()).toHaveValue("Existing draft body")
    expect(textbox()).not.toHaveAttribute("readonly")
  })

  // The approver reads what Approve would publish: the parked draft, not a
  // newer one nobody submitted.
  const PARKED = {
    workflowStatus: "awaiting_approval",
    drafts: [
      draft({ id: "d-newer", body: "A newer draft nobody submitted" }),
      draft({ id: "d-parked", body: "The parked draft" }),
    ],
    pendingDraft: { id: "d-parked", body: "The parked draft" },
  }

  it("shows an approver the parked draft rather than a newer one", () => {
    mount(PARKED)
    expect(screen.getByText("The parked draft")).toBeInTheDocument()
    expect(
      screen.queryByText("A newer draft nobody submitted")
    ).not.toBeInTheDocument()
  })

  // INB-04: one tap on Regenerate used to withdraw the approval request. While
  // the reply is parked it is text, with no tone, Generate or box.
  it("reads a parked reply as text, with no tone, Generate or editor", () => {
    mount(PARKED)
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Regenerate|Generate reply/ })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("radiogroup", { name: "Reply tone" })
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('[data-slot="parked-note"]')
    ).toHaveTextContent("goes back to Needs reply")
  })

  it("opens the parked reply for editing when Edit reply asks, and says what saving does", async () => {
    mount(PARKED)
    act(() => {
      window.dispatchEvent(
        new CustomEvent<ReplyEditDetail>(REPLY_EDIT_EVENT, {
          detail: { reviewId: "rev-1" },
        })
      )
    })
    expect(textbox()).toHaveValue("The parked draft")
    expect(textbox()).not.toHaveAttribute("readonly")
    expect(
      document.querySelector('[data-slot="parked-editing-note"]')
    ).toHaveTextContent("sends this reply back to Needs reply")
  })

  it("parks the reply read-only again after it has left approval and come back", () => {
    let current: ReviewDetail = reviewWith(PARKED)
    vi.spyOn(creditsHook, "useAiCredits").mockReturnValue({
      data: undefined,
    } as UseQueryResult<AiCredits>)
    vi.spyOn(detailHook, "useReviewDetail").mockImplementation(
      () => ({ data: current }) as UseQueryResult<ReviewDetail>
    )
    vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
      mockMutation()
    )
    // A fresh element each time: React skips re-rendering an identical one.
    const tree = () => (
      <Host>
        <ReplyComposer reviewId="rev-1" />
        <SaveProbe />
      </Host>
    )
    const view = render(tree())
    act(() => {
      window.dispatchEvent(
        new CustomEvent<ReplyEditDetail>(REPLY_EDIT_EVENT, {
          detail: { reviewId: "rev-1" },
        })
      )
    })
    expect(textbox()).not.toHaveAttribute("readonly")
    // Saved back to a draft: the composer is the editor, as ever.
    current = reviewWith(EXISTING)
    view.rerender(tree())
    expect(textbox()).not.toHaveAttribute("readonly")
    // Submitted for approval a second time: parked, read-only, again.
    current = reviewWith(PARKED)
    view.rerender(tree())
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
  })

  it("ignores an Edit reply meant for another review", () => {
    mount(PARKED)
    act(() => {
      window.dispatchEvent(
        new CustomEvent<ReplyEditDetail>(REPLY_EDIT_EVENT, {
          detail: { reviewId: "rev-other" },
        })
      )
    })
    expect(
      screen.queryByRole("textbox", { name: "Your reply" })
    ).not.toBeInTheDocument()
  })

  it("seeds the box from a live reply, editable in place", async () => {
    const user = userEvent.setup()
    mount(SETTLED)
    expect(textbox()).toHaveValue("Thanks for the kind words!")
    await user.type(textbox(), " Really.")
    expect(textbox()).toHaveValue("Thanks for the kind words! Really.")
  })

  // INB-09: no "Discard your edits?" step. The regenerate runs at once and
  // the "Reply ready" toast carries Undo, which puts the replaced text back.
  it("regenerates over unsaved text at once, and Undo puts the edits back", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(
      EXISTING,
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "Fresh AI draft" })
    )
    await user.type(textbox(), " edits")
    await generateIn(user, "Warm", "Regenerate")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "warm_professional" })
    await waitFor(() => expect(textbox()).toHaveValue("Fresh AI draft"))
    await user.click(await screen.findByRole("button", { name: "Undo" }))
    expect(textbox()).toHaveValue("Existing draft body edits")
  })

  // The tone is picked inside Generate, so it is chosen at the moment the
  // reply is written, in that tone, over a saved draft.
  it("regenerates over a saved draft in the tone picked from Regenerate", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING)
    expect(textbox()).toHaveValue("Existing draft body")
    await generateIn(user, "Empathetic", "Regenerate")
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "empathetic" })
    expect(
      await screen.findByRole("button", { name: "Regenerate" })
    ).toBeInTheDocument()
  })

  it("holds the box read-only while a reply is being written, so nothing typed meanwhile is lost", () => {
    generating = true
    try {
      mount(EXISTING)
      expect(textbox()).toHaveAttribute("readonly")
    } finally {
      generating = false
    }
    cleanup()
    mount(EXISTING)
    expect(textbox()).not.toHaveAttribute("readonly")
  })

  it("regenerates in a new tone over unsaved edits without asking", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING)
    await user.type(textbox(), "!")
    await generateIn(user, "Concise", "Regenerate")
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(mutateAsync).toHaveBeenCalledWith({ tone: "concise" })
  })

  it("offers Undo after regenerating over a saved draft, restoring it as an edit", async () => {
    const user = userEvent.setup()
    mount(
      EXISTING,
      vi.fn().mockResolvedValue({ ...DRAFT_RESULT, body: "Fresh AI draft" })
    )
    await generateIn(user, "Warm", "Regenerate")
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
    await generateIn(user)
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
    await generateIn(user)
    const alert = await screen.findByRole("alert")
    await user.click(
      within(alert).getByRole("button", { name: "Write my own" })
    )
    await waitFor(() => expect(textbox()).toHaveFocus())
  })

  // INB-14: "not set up" is permanent until someone sets it up, so it is
  // treated like spent credits. The credits read says so up front
  // (`aiConfigured: false`); an older server is learned from the first 503.
  // Either way the one note replaces Generate, and nothing says it twice.
  describe("when AI is not set up for the workspace", () => {
    const NOT_CONFIGURED = new ApiClientError(
      503,
      "ai_not_configured",
      "AI features are not configured."
    )
    const NOTE = "AI replies are not available for this workspace yet."

    it("is known from the credits read, before any attempt", () => {
      const mutateAsync = mount({}, undefined, {
        used: 0,
        remaining: 100,
        aiConfigured: false,
      })
      expect(
        document.querySelector('[data-slot="ai-unavailable"]')
      ).toHaveTextContent(NOTE)
      expect(
        screen.queryByRole("button", { name: /Generate reply|Regenerate/ })
      ).not.toBeInTheDocument()
      expect(screen.queryByText(/credits left/)).not.toBeInTheDocument()
      window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
      expect(mutateAsync).not.toHaveBeenCalled()
    })

    // A rating-only review is answered from a template: no model, so no AI
    // is needed and Generate stays.
    it("keeps Generate for a review with no text, which needs no AI", () => {
      mount({ text: null }, undefined, {
        used: 0,
        remaining: 100,
        aiConfigured: false,
      })
      expect(
        screen.getByRole("button", { name: "Generate reply" })
      ).toBeInTheDocument()
      expect(
        document.querySelector('[data-slot="ai-unavailable"]')
      ).not.toBeInTheDocument()
    })

    it("still offers Generate when the credits read does not say", () => {
      mount({}, undefined, { used: 0, remaining: 100 })
      expect(
        screen.getByRole("button", { name: "Generate reply" })
      ).toBeInTheDocument()
      expect(
        document.querySelector('[data-slot="ai-unavailable"]')
      ).not.toBeInTheDocument()
    })

    it("is learned from the 503 on an older server, said once: the note, no alert", async () => {
      const user = userEvent.setup()
      const mutateAsync = mount({}, vi.fn().mockRejectedValue(NOT_CONFIGURED))
      await generateIn(user)
      await waitFor(() =>
        expect(
          document.querySelector('[data-slot="ai-unavailable"]')
        ).toHaveTextContent(NOTE)
      )
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(
        screen.queryByRole("button", {
          name: /Generate reply|Regenerate|Retry/,
        })
      ).not.toBeInTheDocument()
      window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
      expect(mutateAsync).toHaveBeenCalledTimes(1)
      // Writing by hand is untouched.
      await user.type(textbox(), "Thanks for visiting.")
      expect(textbox()).toHaveValue("Thanks for visiting.")
    })
  })

  // `r` asks the composer to focus; the composer decides. The hotkey layer
  // knows nothing about this review's permissions.
  it("focuses the editor when the focus-reply event asks", async () => {
    mount(SETTLED)
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await waitFor(() => expect(textbox()).toHaveFocus())
  })

  // A viewer reads the reply; nothing on screen looks typeable or pressable.
  it("shows the reply as text, with no editor, to someone who may not edit", async () => {
    const before = document.activeElement
    mount({
      ...SETTLED,
      capabilities: {
        canPublish: false,
        canEdit: false,
        canRequestApproval: false,
      },
    })
    const reply = document.querySelector('[data-slot="reply-readonly"]')
    expect(reply).toHaveTextContent("Thanks for the kind words!")
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument()
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument()
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
    expect(screen.queryByRole("list", { name: "Reply guidance" })).toBeNull()
    fireEvent(window, new Event(REPLY_FOCUS_EVENT))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(document.activeElement).toBe(before)
  })

  it("says there is no reply yet to someone who may not edit", () => {
    mount(
      {
        capabilities: {
          canPublish: false,
          canEdit: false,
          canRequestApproval: false,
        },
      },
      undefined,
      { used: 0, remaining: 200 }
    )
    expect(
      document.querySelector('[data-slot="reply-readonly"]')
    ).toHaveTextContent("No reply yet.")
    expect(screen.queryByText(/credits left/)).not.toBeInTheDocument()
  })

  // Not a viewer: an editor waits for Google, and the box stays read-only
  // (not disabled) until the publish lands.
  it("keeps the editor read-only while a publish is under way", () => {
    mount({ ...EXISTING, workflowStatus: "publish_requested" })
    expect(textbox()).toHaveAttribute("readonly")
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled()
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

describe("ReplyComposer — AI credits", () => {
  it("says how many credits are left beside Generate", () => {
    mount({}, undefined, { used: 193, remaining: 7 })
    expect(screen.getByText("7 of 200 credits left this month")).toBeVisible()
    expect(screen.getByRole("button", { name: "Generate reply" })).toBeEnabled()
  })

  it("disables Generate when out of credits, and keeps writing open", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount({}, undefined, { used: 200, remaining: 0 })
    expect(
      screen.getByText(
        "Out of AI credits until 1 Nov. You can still write a reply yourself."
      )
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Generate reply" })
    ).toBeDisabled()
    await user.type(textbox(), "Thanks for visiting.")
    expect(textbox()).toHaveValue("Thanks for visiting.")
    expect(textbox()).not.toHaveAttribute("readonly")
    window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("does not open the tones, or write anything, when out of credits", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount(EXISTING, undefined, { used: 200, remaining: 0 })
    await user.click(screen.getByRole("button", { name: "Regenerate" }))
    expect(screen.queryByRole("menuitem")).not.toBeInTheDocument()
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("turns Generate off for an unknown allowance but keeps manual writing", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount({}, undefined, {
      allowance: null,
      remaining: null,
      periodId: null,
      periodKind: null,
      periodStart: null,
      periodEnd: null,
    })
    expect(
      screen.getByText(
        "Your AI credit allowance is not confirmed yet, so AI drafting is off for now. You can still write a reply yourself."
      )
    ).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Generate reply" })
    ).toBeDisabled()
    await user.type(textbox(), "Thanks for visiting.")
    expect(textbox()).toHaveValue("Thanks for visiting.")
    window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("turns Generate off while billing is read-only, and keeps manual writing", async () => {
    const user = userEvent.setup()
    const mutateAsync = mount({}, undefined, {
      canUseAi: false,
      accessReason: "read_only",
    })
    expect(screen.getByText(/subscription is read-only/)).toBeVisible()
    expect(
      screen.getByRole("button", { name: "Generate reply" })
    ).toBeDisabled()
    // Writing by hand stays open: the editor takes text, and neither the
    // generate event nor `g` reaches the AI route.
    await user.type(textbox(), "Thank you for the kind words.")
    expect(textbox()).toHaveValue("Thank you for the kind words.")
    window.dispatchEvent(new Event(REPLY_GENERATE_EVENT))
    expect(mutateAsync).not.toHaveBeenCalled()
  })

  it("names the period end from the balance in a paid period", () => {
    mount({}, undefined, {
      used: 50,
      allowance: 50,
      remaining: 0,
      periodKind: "paid_period",
      periodEnd: "2026-11-14T08:00:00.000Z",
    })
    expect(
      screen.getByText(
        "Out of AI credits until 14 Nov. You can still write a reply yourself."
      )
    ).toBeVisible()
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
    expect(probe).toHaveAttribute(
      "title",
      "Write the reply before publishing it."
    )
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

// The bar under the words is AI rewrite (Generate, with the tone inside it)
// and a neutral count that appears with the first character; the limit itself
// is the foot's, in the unit Google counts (bytes).
describe("ReplyComposer — the insert bar", () => {
  it("counts the characters neutrally and leaves the limit to the foot", () => {
    mount(EXISTING)
    const count = document.querySelector<HTMLElement>(
      '[data-slot="char-count"]'
    )!
    expect(count).toHaveTextContent("19 characters")
    expect(count).toHaveClass("text-count", "tabular-nums", "text-ink-muted")
    fireEvent.change(textbox(), { target: { value: "a".repeat(4097) } })
    expect(count).toHaveTextContent("4,097 characters")
    // Characters are not the limit's unit, so the bar never turns red on a
    // byte count it does not show.
    expect(count).toHaveClass("text-ink-muted")
    expect(count).not.toHaveClass("text-danger-ink")
    expect(textbox()).toHaveAttribute("aria-invalid", "true")
  })
  it("offers no template or variable insert (D10)", () => {
    mount(EXISTING)
    expect(
      screen.queryByRole("button", { name: "Insert template" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Insert variable" })
    ).not.toBeInTheDocument()
  })
})
