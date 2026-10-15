import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ClientScopeRoot,
  usePageScopeHandler,
} from "@/components/app-shell/client-context"
import { ShellBackLink } from "@/components/app-shell/app-bar"
import {
  PageChromeProvider,
  usePageChromeOverride,
} from "@/components/app-shell/page-chrome"
import { InboxView } from "@/components/inbox/inbox-view"
import { QueryProvider } from "@/lib/queries/provider"
import { Toaster } from "@/components/ui/toast"
import type {
  ReviewDetail as ReviewDetailData,
  ReviewRow,
} from "@/lib/api/reviews"
import type { ReviewCounts } from "@/lib/contracts/reviews"
import { __resetDraftSources } from "@/lib/api/draft-stash"
import {
  PRIMARY_ACTION_EVENT,
  PUBLISH_PULSE_EVENT,
  PUBLISH_PULSE_MS,
  REPLY_GENERATE_EVENT,
} from "@/lib/inbox/events"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as draftMutations from "@/lib/queries/use-draft-mutations"
import * as reviewsHook from "@/lib/queries/use-reviews"
import * as countsHook from "@/lib/queries/use-review-counts"
import * as connHealthHook from "@/lib/queries/use-connection-health"
import * as locationsApi from "@/lib/api/locations"

const push = vi.fn()
const replace = vi.fn()
const back = vi.fn()
// Stable across renders (like the real hook when the URL hasn't changed) —
// a fresh instance per call would make every `useMemo([searchParams])` in
// `InboxViewInner` recompute every render, which is unnecessary noise here.
const INITIAL_PARAMS = new URLSearchParams("selected=rev-1&rating=4")
let currentParams = INITIAL_PARAMS

vi.mock("next/navigation", () => ({
  useRouter: () => ({ back }),
  useSearchParams: () => currentParams,
}))
// The inbox rewrites its own query string through the history API, never
// through the router (no RSC round trip per click or keystroke).
vi.mock("@/lib/navigation/shallow-url", () => ({
  replaceUrl: (href: string) => replace(href),
  pushUrl: (href: string) => push(href),
}))

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "rev-1",
    location: {
      id: "loc-1",
      name: "Riverside",
      clientId: "c1",
      clientName: "Old Crown Group",
    },
    reviewer: {
      displayName: "Sam Traveller",
      isAnonymous: false,
      profilePhotoUrl: null,
    },
    rating: 4,
    text: "Great stay, would return.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-07-30T10:00:00.000Z",
    updateTime: "2026-07-30T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "drafted",
    draftId: "d1",
    draftBody: "Seed",
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
  }
}

function reviewDetail(): ReviewDetailData {
  return {
    review: {
      id: "rev-1",
      reviewerDisplayName: "Sam Traveller",
      reviewerIsAnonymous: false,
      reviewerProfilePhotoUrl: null,
      rating: 4,
      text: "Great stay, would return.",
      detectedLanguageCode: "en",
      languageConfidence: 0.9,
      createTime: "2026-07-30T10:00:00.000Z",
      updateTime: "2026-07-30T10:00:00.000Z",
      hasMedia: false,
      workflowStatus: "drafted",
      locationId: "loc-1",
      locationName: "Riverside",
      timezone: "Europe/London",
      verified: true,
      media: [],
      drafts: [
        {
          id: "d1",
          source: "ai",
          body: "Seed",
          bodyBytes: 4,
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
  }
}

// Same shape/rationale as reply-composer.test.tsx's `mockMutation()`: `any`
// generics are the only instantiation assignable to both
// useGenerateOrSaveDraft's and useVerifyDraft's exact mutation-result types
// (see that file's comment for why `never`/`unknown` both fail `tsc` here).
function mockMutation() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see reply-composer.test.tsx
  } as unknown as UseMutationResult<any, Error, any>
}

beforeEach(() => {
  __resetDraftSources()
  sessionStorage.clear()
  push.mockClear()
  replace.mockClear()
  back.mockClear()
  currentParams = INITIAL_PARAMS

  // jsdom does not implement matchMedia. The inbox asks it only for
  // behaviour (push or replace, auto-select, scroll and focus on open); the
  // layout is CSS keyed on `data-view`, which jsdom does not apply. These
  // tests work the filters, queues and list while a review is open, as on
  // the side-by-side desk.
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: true }))

  vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
    data: { pages: [{ items: [row()], nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  } as unknown as ReturnType<typeof reviewsHook.useReviews>)

  vi.spyOn(countsHook, "useReviewCounts").mockReturnValue({
    data: {
      total: 1,
      byStatus: {},
      byQueue: {
        needs_reply: 0,
        approval: 0,
        awaiting_my_approval: 0,
        awaiting_others: 0,
        publishing: 0,
        failed: 0,
        done: 0,
        all: 0,
      },
    },
  } as unknown as UseQueryResult<ReviewCounts>)

  vi.spyOn(connHealthHook, "useConnectionHealth").mockReturnValue({
    status: "connected",
    label: "Live data",
  })

  vi.spyOn(locationsApi, "fetchLocations").mockResolvedValue({ locations: [] })

  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
    data: reviewDetail(),
  } as UseQueryResult<ReviewDetailData>)

  vi.spyOn(draftMutations, "useGenerateOrSaveDraft").mockReturnValue(
    mockMutation()
  )
  vi.spyOn(draftMutations, "useVerifyDraft").mockReturnValue(mockMutation())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// Reads what the inbox told the shell's chrome (<PageChrome>), as the app
// bar's back control would.
function ChromeProbe() {
  const back = usePageChromeOverride().back
  return (
    <button
      type="button"
      data-testid="chrome-back"
      data-href={back?.href}
      onClick={() => back?.onNavigate?.()}
    >
      {back ? back.label : "none"}
    </button>
  )
}

// The shell app bar's leading back link, as AppBar draws it from a page's
// <PageChrome back>: the pushed review's one way back below lg.
function AppBarBack() {
  const back = usePageChromeOverride().back
  return back ? <ShellBackLink target={back} /> : null
}

function inboxUi() {
  return (
    <PageChromeProvider>
      <AppBarBack />
      <QueryProvider>
        <Toaster>
          <InboxView />
        </Toaster>
      </QueryProvider>
    </PageChromeProvider>
  )
}

function renderInbox() {
  return render(inboxUi())
}

// The reply editor is always open, so every dirty-guard case below types
// straight into it.
async function dirtyComposer(user: ReturnType<typeof userEvent.setup>) {
  const textbox = screen.getByRole("textbox", { name: "Your reply" })
  await user.type(textbox, " extra")
  return textbox
}

// A filter change narrows the list and leaves a dirty reply open: the
// discard confirm used to pop up a moment after a debounced search keystroke,
// for an edit the search had no reason to touch.
describe("InboxView — filters keep a dirty reply open", () => {
  it("applies a filter change without a prompt and keeps the selection", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(
      screen.getByRole("button", { name: /^Remove filter: Rating/ })
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("selected=rev-1")
    expect(replace.mock.calls[0][0]).not.toContain("rating=")
    expect(textbox).toHaveValue("Seed extra")
  })

  it("clears all filters without a prompt and keeps the selection", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Clear all filters" }))
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("selected=rev-1")
    expect(textbox).toHaveValue("Seed extra")
  })

  it("drops the selection on a filter change when nothing is unsaved", async () => {
    const user = userEvent.setup()
    renderInbox()

    await user.click(
      screen.getByRole("button", { name: /^Remove filter: Rating/ })
    )
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })
})

// Each of these nav affordances drops `selected` from the URL, which would
// unmount the (dirty) composer — Task 6 fix round 1: every one must gate
// through the same dirtyGate() used by onSelect, prompting the discard
// AlertDialog and aborting on "Keep editing" so the edit and the selection
// both survive.
describe("InboxView — dirty-guard gates nav that clears the selection", () => {
  it("gates a queue change", async () => {
    // The rail became a tab strip above the workspace, but it keeps the
    // "Review queues" navigation landmark — the queues are still the inbox's
    // primary navigation, wherever they are drawn.
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)
    const queues = screen.getByRole("navigation", { name: "Review queues" })

    await user.click(within(queues).getByRole("button", { name: /^Done/ }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(within(queues).getByRole("button", { name: /^Done/ }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })

  it("gates 'Back to Inbox'", async () => {
    const user = userEvent.setup()
    // Below lg, where the app bar's "‹ Inbox" is the one way back.
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(await screen.findByRole("link", { name: "Back to Inbox" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("link", { name: "Back to Inbox" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).not.toContain("selected=")
  })
})

describe("InboxView — client scope", () => {
  it("keeps the client filter when the queue changes", async () => {
    const user = userEvent.setup()
    currentParams = new URLSearchParams("selected=rev-1&clientId=c1")
    renderInbox()
    const queues = screen.getByRole("navigation", { name: "Review queues" })

    await user.click(within(queues).getByRole("button", { name: /^Done/ }))
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("clientId=c1")
    expect(replace.mock.calls[0][0]).toContain("queue=done")
  })

  // The top-bar switcher reaches the inbox through the shell's page handler.
  function SwitchTo({ clientId }: { clientId: string | null }) {
    const pageHandler = usePageScopeHandler()
    const [result, setResult] = useState("")
    return (
      <>
        <button
          type="button"
          onClick={async () => {
            const applied = await pageHandler()?.(clientId)
            setResult(String(applied))
          }}
        >
          Switch to {clientId ?? "all clients"}
        </button>
        <output aria-label="Switch result">{result}</output>
      </>
    )
  }

  function renderScopedInbox(clientId: string | null) {
    return render(
      <QueryProvider>
        <Toaster>
          <ClientScopeRoot>
            <InboxView />
            <SwitchTo clientId={clientId} />
          </ClientScopeRoot>
        </Toaster>
      </QueryProvider>
    )
  }

  it("asks before the switcher closes a review with an unsaved reply", async () => {
    const user = userEvent.setup()
    currentParams = new URLSearchParams(
      "selected=rev-1&clientId=c1&queue=failed"
    )
    renderScopedInbox("c2")
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Switch to c2" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")
    expect(
      screen.getByRole("status", { name: "Switch result" })
    ).toHaveTextContent("false")

    await user.click(screen.getByRole("button", { name: "Switch to c2" }))
    await user.click(screen.getByRole("button", { name: "Discard" }))
    expect(replace).toHaveBeenCalledTimes(1)
    const href = replace.mock.calls[0][0] as string
    expect(href).toContain("clientId=c2")
    expect(href).toContain("queue=failed")
    expect(href).not.toContain("selected=")
    expect(
      screen.getByRole("status", { name: "Switch result" })
    ).toHaveTextContent("true")
  })

  it("widens to all clients without a prompt, keeping the open review", async () => {
    const user = userEvent.setup()
    currentParams = new URLSearchParams("selected=rev-1&clientId=c1")
    renderScopedInbox(null)
    await dirtyComposer(user)

    await user.click(
      screen.getByRole("button", { name: "Switch to all clients" })
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("selected=rev-1")
    expect(replace.mock.calls[0][0]).not.toContain("clientId=")
  })

  it("takes the Client chip through the same guarded path", async () => {
    const user = userEvent.setup()
    currentParams = new URLSearchParams("selected=rev-1&clientId=c1")
    renderInbox()
    await dirtyComposer(user)

    await user.click(
      screen.getByRole("button", { name: /^Remove filter: Client/ })
    )
    // Widening keeps the review, so nothing is asked.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    expect(replace.mock.calls[0][0]).toContain("selected=rev-1")
    expect(replace.mock.calls[0][0]).not.toContain("clientId=")
  })

  it("scopes the queue counts to the client in view", () => {
    currentParams = new URLSearchParams("selected=rev-1&clientId=c1")
    renderInbox()
    expect(countsHook.useReviewCounts).toHaveBeenCalledWith({
      clientId: "c1",
    })
  })
})

// A failed list fetch must not render as "No reviews yet" (the genuinely
// empty-queue copy) with no way to recover -- that silently mislabels a real
// error as an empty inbox.
describe("InboxView — list fetch failure", () => {
  it("shows a retry affordance instead of the empty-queue copy", async () => {
    const user = userEvent.setup()
    const refetch = vi.fn()
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch,
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)

    renderInbox()

    expect(
      screen.getByText("We could not load your reviews.")
    ).toBeInTheDocument()
    expect(screen.queryByText("No reviews yet")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Try again" }))
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})

describe("InboxView — next and previous review", () => {
  it("moves selection to the next loaded review", async () => {
    const user = userEvent.setup()
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: {
        pages: [
          {
            items: [
              row(),
              row({
                id: "rev-2",
                reviewer: {
                  displayName: "Pat Guest",
                  isAnonymous: false,
                  profilePhotoUrl: null,
                },
                text: "Second stay.",
              }),
            ],
            nextCursor: null,
          },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)

    renderInbox()
    // J steps down the queue, as the review's Next step does below lg.
    await user.keyboard("j")
    // Replace, not push: stepping through a queue must not leave one history
    // entry per review between the operator and the page they came from.
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalled()
    expect(replace.mock.calls[0][0]).toContain("selected=rev-2")
  })

  it("steps from the review itself and says where it sits", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: {
        pages: [
          {
            items: [row(), row({ id: "rev-2" }), row({ id: "rev-3" })],
            nextCursor: null,
          },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)
    const { container } = renderInbox()

    expect(
      screen.getByRole("heading", { level: 1, name: "Sam Traveller" })
    ).toBeInTheDocument()
    // The toolbar's "Inbox" is hidden with the list, and not a second h1.
    expect(document.querySelectorAll("h1")).toHaveLength(1)
    expect(
      container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("Review 1 of 3")
    // The first review has nothing before it.
    expect(
      screen.getByRole("button", { name: "Previous review" })
    ).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Next review" }))
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("selected=rev-2")
  })

  it("keeps focus on the step pressed while the next review is still loading", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: {
        pages: [
          {
            items: [row(), row({ id: "rev-2" }), row({ id: "rev-3" })],
            nextCursor: null,
          },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)
    // Only the first review is cached; the next one is still on its way.
    const detailSpy = vi
      .spyOn(detailHook, "useReviewDetail")
      .mockImplementation(
        (id) =>
          (id === "rev-1"
            ? { data: reviewDetail() }
            : {
                isPending: true,
                isError: false,
              }) as UseQueryResult<ReviewDetailData>
      )
    const view = renderInbox()
    await user.click(screen.getByRole("button", { name: "Next review" }))
    currentParams = new URLSearchParams(
      (replace.mock.calls[0][0] as string).split("?")[1]
    )
    view.rerender(inboxUi())

    // The pane is loading, yet it still draws the steps and the position,
    // and the Next step it was reached from holds focus.
    expect(view.container.querySelector("[aria-busy=true]")).not.toBeNull()
    const next = screen.getByRole("button", { name: "Next review" })
    await waitFor(() => expect(next).toHaveFocus())
    expect(
      view.container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("Review 2 of 3")

    // The review lands: the loading steps give way to the thread's own, and
    // focus stays on Next rather than falling to <body>.
    detailSpy.mockImplementation(
      () => ({ data: reviewDetail() }) as UseQueryResult<ReviewDetailData>
    )
    view.rerender(inboxUi())
    expect(view.container.querySelector("[aria-busy=true]")).toBeNull()
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Next review" })).toHaveFocus()
    )
  })

  it("keeps Next on at the last loaded review while another page follows", () => {
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: { pages: [{ items: [row()], nextCursor: "c" }] },
      isPending: false,
      isError: false,
      hasNextPage: true,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)
    const { container } = renderInbox()
    expect(
      container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("1 of 1+")
    expect(screen.getByRole("button", { name: "Next review" })).toBeEnabled()
  })
})

describe("InboxView — history", () => {
  it("pushes when a phone opens a review from the list, so Back returns to it", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const view = renderInbox()

    const rowButton = view.container.querySelector<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    await user.click(rowButton!)
    expect(replace).not.toHaveBeenCalled()
    expect(push).toHaveBeenCalledTimes(1)
    expect(push.mock.calls[0][0]).toContain("selected=rev-1")
  })

  it("pops the pushed entry on Back to Inbox rather than adding one", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const view = renderInbox()
    await user.click(
      view.container.querySelector<HTMLButtonElement>(
        '[data-slot="review-row"]'
      )!
    )
    expect(push).toHaveBeenCalledTimes(1)

    // The router mock does not move the URL; serve the pushed one.
    currentParams = new URLSearchParams(
      new URL(push.mock.calls[0][0], "http://x").search
    )
    view.rerender(inboxUi())
    // Below lg the one way back is the app bar's "‹ Inbox" link; the
    // review head draws no second back button.
    expect(
      screen.queryByRole("button", { name: "Back to Inbox" })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: "Back to Inbox" }))
    expect(back).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("gives the shell's app bar a labelled way back that pops the pushed entry", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const ui = () => (
      <PageChromeProvider>
        <ChromeProbe />
        <QueryProvider>
          <Toaster>
            <InboxView />
          </Toaster>
        </QueryProvider>
      </PageChromeProvider>
    )
    const view = render(ui())
    // On the list, the Inbox is a top-level page: no override.
    expect(screen.getByTestId("chrome-back")).toHaveTextContent("none")
    await user.click(
      view.container.querySelector<HTMLButtonElement>(
        '[data-slot="review-row"]'
      )!
    )
    currentParams = new URLSearchParams(
      new URL(push.mock.calls[0][0], "http://x").search
    )
    view.rerender(ui())

    // "‹ Inbox", linking to the same list without the open review.
    const probe = screen.getByTestId("chrome-back")
    expect(probe).toHaveTextContent("Inbox")
    expect(probe).toHaveAttribute(
      "data-href",
      expect.stringContaining("/inbox?")
    )
    expect(probe.getAttribute("data-href")).toContain("rating=4")
    expect(probe.getAttribute("data-href")).not.toContain("selected=")
    // Activating it runs the review head's back: pop, don't push the list.
    await user.click(probe)
    expect(back).toHaveBeenCalledTimes(1)
    expect(replace).not.toHaveBeenCalled()
  })

  it("adds no app-bar back where the list sits beside the review", () => {
    // The default stub matches every query: a desk, split view.
    render(
      <PageChromeProvider>
        <ChromeProbe />
        <QueryProvider>
          <Toaster>
            <InboxView />
          </Toaster>
        </QueryProvider>
      </PageChromeProvider>
    )
    expect(screen.getByTestId("chrome-back")).toHaveTextContent("none")
  })

  it("leaves a dirty pushed review to the leave guard's one prompt", async () => {
    const user = userEvent.setup()
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const view = renderInbox()
    await user.click(
      view.container.querySelector<HTMLButtonElement>(
        '[data-slot="review-row"]'
      )!
    )
    currentParams = new URLSearchParams(
      new URL(push.mock.calls[0][0], "http://x").search
    )
    view.rerender(inboxUi())
    await dirtyComposer(user)

    // The way back below lg is the app bar's link, which the leave guard
    // holds like any link: ONE prompt asks, and the in-page gate does not
    // ask again after it, or Discard would be asked twice.
    await user.click(screen.getByRole("link", { name: "Back to Inbox" }))
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard unsaved reply?",
    })
    expect(back).not.toHaveBeenCalled()
    await user.click(within(prompt).getByRole("button", { name: "Discard" }))
    await waitFor(() => expect(back).toHaveBeenCalledTimes(1))
    expect(screen.queryAllByRole("alertdialog")).toHaveLength(0)
    expect(replace).not.toHaveBeenCalled()
  })

  it("replaces when a row is chosen beside an open review", async () => {
    const user = userEvent.setup()
    const view = renderInbox()

    const rowButton = view.container.querySelector<HTMLButtonElement>(
      '[data-slot="review-row"]'
    )
    await user.click(rowButton!)
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(1)
  })
})

describe("InboxView — row count announcement", () => {
  it("announces the count for a filter set once, not again as more rows load", () => {
    const view = renderInbox()
    const status = () =>
      view.container.querySelector<HTMLElement>(
        '[data-slot="inbox-list-pane"] [role="status"]'
      )
    expect(status()).toHaveTextContent("1 review")

    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: {
        pages: [
          { items: [row()], nextCursor: "c" },
          { items: [row({ id: "rev-2" })], nextCursor: null },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)
    view.rerender(inboxUi())
    // The visible count follows the rows; the spoken one stays put.
    expect(screen.getByText("2 reviews")).toBeInTheDocument()
    expect(status()).toHaveTextContent("1 review")
  })
})

// The detail pane is keyed on the selected id, so advancing on the same tick
// as the publish event unmounted the situation strip before its success ring
// ever painted. The move now waits out the pulse (one shared constant), and
// the window listener is subscribed once rather than on every render.
describe("InboxView — publish pulse, then advance", () => {
  function twoReviews() {
    vi.spyOn(reviewsHook, "useReviews").mockReturnValue({
      data: {
        pages: [
          {
            items: [row(), row({ id: "rev-2", text: "Second stay." })],
            nextCursor: null,
          },
        ],
      },
      isPending: false,
      isError: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
    } as unknown as ReturnType<typeof reviewsHook.useReviews>)
  }

  function publish(reviewId: string, status?: "published" | "pending") {
    act(() => {
      window.dispatchEvent(
        new CustomEvent(PUBLISH_PULSE_EVENT, { detail: { reviewId, status } })
      )
    })
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("keeps the published review selected for the pulse, then moves on", async () => {
    twoReviews()
    renderInbox()

    publish("rev-1")
    // Still on rev-1 while the strip is pulsing.
    expect(replace).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(PUBLISH_PULSE_MS - 1)
    })
    expect(replace).not.toHaveBeenCalled()

    await act(async () => {
      vi.advanceTimersByTime(1)
    })
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalledTimes(1)
    expect(replace.mock.calls[0][0]).toContain("selected=rev-2")
  })

  it("says what happened and where the operator now is", async () => {
    twoReviews()
    const view = renderInbox()

    publish("rev-1", "pending")
    await act(async () => {
      vi.advanceTimersByTime(PUBLISH_PULSE_MS)
    })
    expect(
      view.container.querySelector('[data-slot="inbox-advance-status"]')
    ).toHaveTextContent(
      "Reply sent to Google. Now showing Sam Traveller's review."
    )
  })

  it("moves focus to the new review's name after the advance", async () => {
    twoReviews()
    const view = renderInbox()

    publish("rev-1")
    await act(async () => {
      vi.advanceTimersByTime(PUBLISH_PULSE_MS)
    })
    // The router is a mock, so the URL does not move; re-render as if it had.
    currentParams = new URLSearchParams("selected=rev-2&rating=4")
    view.rerender(inboxUi())
    expect(
      view.container.querySelector('[data-slot="review-heading"]')
    ).toHaveFocus()
  })

  it("ignores a publish for a review that is not the selected one", async () => {
    twoReviews()
    renderInbox()

    publish("rev-2")
    await act(async () => {
      vi.advanceTimersByTime(PUBLISH_PULSE_MS)
    })
    expect(push).not.toHaveBeenCalled()
    expect(replace).not.toHaveBeenCalled()
  })

  it("subscribes to the publish event once, not on every render", () => {
    twoReviews()
    const add = vi.spyOn(window, "addEventListener")
    const remove = vi.spyOn(window, "removeEventListener")
    const view = renderInbox()
    const subscriptions = () =>
      add.mock.calls.filter(([type]) => type === PUBLISH_PULSE_EVENT).length
    const unsubscriptions = () =>
      remove.mock.calls.filter(([type]) => type === PUBLISH_PULSE_EVENT).length

    // Two on mount: this view's, and the situation strip's inside the detail
    // pane. Neither should churn as the tree re-renders.
    const mounted = subscriptions()
    expect(mounted).toBeGreaterThan(0)
    view.rerender(inboxUi())
    view.rerender(inboxUi())
    expect(subscriptions()).toBe(mounted)
    expect(unsubscriptions()).toBe(0)
  })
})

// Below lg the list and the open review take turns (reference `data-view`):
// the review replaces the list and the controls above it rather than sliding
// a sheet over them, and the list stays mounted so its selected row and its
// place survive the trip. The swap is CSS keyed on `data-view`, which comes
// from the URL, so the server already renders the right view.
describe("InboxView — list and detail", () => {
  it("renders the detail view from ?selected=, whatever the width", () => {
    // matchMedia is never asked which view to draw: a desk answer here
    // still yields the detail view.
    const { container } = renderInbox()
    const inbox = container.querySelector('[data-slot="inbox"]')
    expect(inbox).toHaveAttribute("data-view", "detail")
    // The controls and the list hide below lg with CSS, staying mounted.
    for (const slot of ["inbox-controls", "inbox-list-column"]) {
      expect(
        container.querySelector(`[data-slot="${slot}"]`)?.className
      ).toContain("group-data-[view=detail]/inbox:max-lg:hidden")
    }
    expect(
      container.querySelector('[data-slot="review-row"][aria-current="true"]')
    ).not.toBeNull()
    expect(
      screen.getByRole("region", { name: "Selected review" })
    ).toBeInTheDocument()
    // From lg the list is beside the review: "Inbox" is the one h1, and the
    // reviewer's name is an h2 rather than a second h1.
    expect(document.querySelectorAll("h1")).toHaveLength(1)
    expect(
      screen.getByRole("heading", { level: 1, name: "Inbox" })
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="review-heading"]')?.tagName
    ).toBe("H2")
  })

  // The retired inbox-mail.module.css, as token utilities on the parts
  // themselves: one white surface, one hairline above the split, flat panes
  // that run edge to edge on a phone, and a hairline between list and review.
  it("lays the workspace out flat with token utilities, not a CSS module", () => {
    const { container } = renderInbox()
    const slot = (name: string) =>
      container.querySelector<HTMLElement>(`[data-slot="${name}"]`)!
    expect(slot("inbox")).toHaveClass("bg-surface")
    expect(slot("inbox").className).not.toMatch(/\bgap-/)
    expect(slot("inbox-split")).toHaveClass("border-t", "border-line")
    expect(slot("inbox-split").className).not.toMatch(/\bgap-/)
    expect(slot("inbox-list-column")).toHaveClass(
      "lg:border-r",
      "lg:border-line"
    )
    for (const pane of ["inbox-list-pane", "inbox-inspector"]) {
      expect(slot(pane)).toHaveClass("max-md:-mx-4", "bg-surface")
      expect(slot(pane)).not.toHaveClass("border")
      expect(slot(pane).className).not.toContain("rounded-")
    }
    expect(slot("inbox-workspace-controls")).toHaveClass(
      "pt-4",
      "pb-2",
      "md:px-5",
      "md:pt-5",
      // Bleeds like the panes on a phone, padded back to the page gutter.
      "max-md:-mx-4",
      "px-4"
    )
    expect(slot("inbox-list-header")).toHaveClass("px-(--np-page-pad-x)")
    expect(slot("inbox-list-column")).toContainElement(slot("inbox-controls"))
    expect(slot("inbox-inspector")).not.toContainElement(slot("inbox-controls"))
  })

  it("renders the list view, with the review pane waiting, without ?selected=", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const { container } = renderInbox()
    expect(container.querySelector('[data-slot="inbox"]')).toHaveAttribute(
      "data-view",
      "list"
    )
    const inspector = screen.getByRole("region", { name: "Selected review" })
    expect(inspector.className).toContain(
      "group-data-[view=list]/inbox:max-lg:hidden"
    )
    expect(
      within(inspector).getByRole("heading", { name: "No review selected" })
    ).toBeInTheDocument()
  })

  it("puts focus on the app bar's Back to Inbox when a review opens below lg", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    currentParams = new URLSearchParams("rating=4")
    const view = renderInbox()
    currentParams = new URLSearchParams("rating=4&selected=rev-1")
    view.rerender(inboxUi())
    // One back control: the app bar's link (it arrives a render after the
    // review opens), not a second button in the review.
    const link = await screen.findByRole("link", { name: "Back to Inbox" })
    expect(
      screen.queryByRole("button", { name: "Back to Inbox" })
    ).not.toBeInTheDocument()
    await waitFor(() => expect(link).toHaveFocus())
    // No head band above the review: the name is the h1, and the steps sit
    // on its row.
    expect(view.container.querySelector('[data-slot="review-head"]')).toBeNull()
    const name = view.container.querySelector('[data-slot="review-heading"]')
    expect(name?.tagName).toBe("H1")
    const steps = view.container.querySelector('[data-slot="review-steps"]')
    expect(steps).not.toBeNull()
    expect(
      within(steps as HTMLElement).getByRole("button", { name: "Next review" })
    ).toBeInTheDocument()
    expect(steps?.parentElement).toBe(name?.parentElement)
  })

  it("leaves focus alone on a page that arrives already on a review", async () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    renderInbox()
    const link = await screen.findByRole("link", { name: "Back to Inbox" })
    expect(link).not.toHaveFocus()
  })

  it("leaves focus alone when a review opens beside the list", () => {
    renderInbox()
    // The list is beside the review, so there is no way back to draw.
    expect(
      screen.queryByRole("button", { name: "Back to Inbox" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("link", { name: "Back to Inbox" })
    ).not.toBeInTheDocument()
    expect(document.body).toHaveFocus()
  })
})

describe("InboxView — shortcuts dialog", () => {
  it("lists only the keys that are bound in the inbox", async () => {
    const user = userEvent.setup()
    renderInbox()

    await user.keyboard("?")
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    })
    expect(within(dialog).getByText("Next review")).toBeInTheDocument()
    expect(within(dialog).getByText("Write a reply")).toBeInTheDocument()
    expect(
      within(dialog).getByText("Generate a first draft")
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText("Press the publish bar's main button")
    ).toBeInTheDocument()
    // `e` has no binding in the inbox; listing it would promise a key that
    // does nothing.
    expect(
      within(dialog).queryByText("Assign to a colleague")
    ).not.toBeInTheDocument()
  })
})

describe("InboxView — a and g", () => {
  it("asks the publish bar to press its main button on `a`", async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(PRIMARY_ACTION_EVENT, listener)
    renderInbox()
    await user.keyboard("a")
    window.removeEventListener(PRIMARY_ACTION_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("asks the composer for a first draft on `g`", async () => {
    const user = userEvent.setup()
    const listener = vi.fn()
    window.addEventListener(REPLY_GENERATE_EVENT, listener)
    renderInbox()
    await user.keyboard("g")
    window.removeEventListener(REPLY_GENERATE_EVENT, listener)
    expect(listener).toHaveBeenCalledTimes(1)
  })
})

// W5-02: the inbox read the shared 15 s clock to the millisecond, so the
// whole view — toolbar, list, every row, the review — re-rendered four times
// a minute. It only needs the hour (the age presets); the relative times in
// the rows keep their own subscription.
describe("InboxView — the clock", () => {
  afterEach(() => vi.useRealTimers())

  it("does not re-render the inbox on the clock's tick", () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-14T10:00:10Z"))
    renderInbox()
    act(() => vi.advanceTimersByTime(1_000))
    const renders = vi.mocked(reviewsHook.useReviews).mock.calls.length
    act(() => vi.advanceTimersByTime(4 * 15_000))
    expect(vi.mocked(reviewsHook.useReviews).mock.calls.length).toBe(renders)
  })
})

// W2-01: the flattened rows and the load-more handler were rebuilt on every
// render (the query result is a new object each time), so the list's
// end-of-list observer was torn down and rebuilt with every render.
describe("InboxView — list stability", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("keeps the end-of-list observer across re-renders with the same rows", () => {
    let observers = 0
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor() {
          observers += 1
        }
        observe() {}
        disconnect() {}
      }
    )
    const data = { pages: [{ items: [row()], nextCursor: "next" }] }
    const fetchNextPage = vi.fn()
    // A fresh result object per render, as TanStack's tracked result is.
    vi.mocked(reviewsHook.useReviews).mockImplementation(
      () =>
        ({
          data,
          isPending: false,
          isError: false,
          hasNextPage: true,
          isFetchingNextPage: false,
          fetchNextPage,
        }) as unknown as ReturnType<typeof reviewsHook.useReviews>
    )
    const view = renderInbox()
    const settled = observers
    expect(settled).toBeGreaterThan(0)
    view.rerender(inboxUi())
    view.rerender(inboxUi())
    expect(observers).toBe(settled)
  })
})
