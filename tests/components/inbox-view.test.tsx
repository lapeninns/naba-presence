import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { UseMutationResult, UseQueryResult } from "@tanstack/react-query"
import { useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  ClientScopeRoot,
  usePageScopeHandler,
} from "@/components/app-shell/client-context"
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
// Stable across renders (like the real hook when the URL hasn't changed) —
// a fresh instance per call would make every `useMemo([searchParams])` in
// `InboxViewInner` recompute every render, which is unnecessary noise here.
const INITIAL_PARAMS = new URLSearchParams("selected=rev-1&rating=4")
let currentParams = INITIAL_PARAMS

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentParams,
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
  currentParams = INITIAL_PARAMS

  // jsdom does not implement matchMedia; the auto-select effect's isDesktop
  // check calls it unconditionally. `selected` is already set in every test
  // here, so autoSelectId short-circuits before `isDesktop` matters. It does
  // decide the layout, though: below lg an open review REPLACES the list and
  // the controls above it (they are `hidden`), so these tests — which work
  // the filters, queues and list while a review is open — run on the
  // side-by-side desktop workspace.
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

function renderInbox() {
  return render(
    <QueryProvider>
      <Toaster>
        <InboxView />
      </Toaster>
    </QueryProvider>
  )
}

// The pane now opens a saved reply as readable text; the composer is entered
// deliberately. Every dirty-guard case below still needs a dirty composer, so
// they all go through Edit reply first.
async function dirtyComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Edit reply" }))
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
      screen.getByRole("button", { name: "Remove rating filter" })
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
      screen.getByRole("button", { name: "Remove rating filter" })
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

  it("gates 'Back to reviews'", async () => {
    const user = userEvent.setup()
    renderInbox()
    const textbox = await dirtyComposer(user)

    await user.click(screen.getByRole("button", { name: "Back to reviews" }))
    expect(screen.getByRole("alertdialog")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Keep editing" }))
    expect(replace).not.toHaveBeenCalled()
    expect(textbox).toHaveValue("Seed extra")

    await user.click(screen.getByRole("button", { name: "Back to reviews" }))
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
      screen.getByRole("button", { name: "Remove client filter" })
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
    expect(
      screen.getByRole("button", { name: "Previous review" })
    ).toBeDisabled()
    await user.click(screen.getByRole("button", { name: "Next review" }))
    // Replace, not push: stepping through a queue must not leave one history
    // entry per review between the operator and the page they came from.
    expect(push).not.toHaveBeenCalled()
    expect(replace).toHaveBeenCalled()
    expect(replace.mock.calls[0][0]).toContain("selected=rev-2")
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
    view.rerender(
      <QueryProvider>
        <Toaster>
          <InboxView />
        </Toaster>
      </QueryProvider>
    )
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
    view.rerender(
      <QueryProvider>
        <Toaster>
          <InboxView />
        </Toaster>
      </QueryProvider>
    )
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
    view.rerender(
      <QueryProvider>
        <Toaster>
          <InboxView />
        </Toaster>
      </QueryProvider>
    )
    view.rerender(
      <QueryProvider>
        <Toaster>
          <InboxView />
        </Toaster>
      </QueryProvider>
    )
    expect(subscriptions()).toBe(mounted)
    expect(unsubscriptions()).toBe(0)
  })
})

// Below lg the list and the open review take turns (reference `data-view`):
// the review replaces the list and the controls above it rather than sliding
// a sheet over them, and the list stays mounted so its selected row and its
// place survive the trip.
describe("InboxView — narrow screens", () => {
  it("shows the open review in place of the list and the controls", () => {
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false }))
    const { container } = renderInbox()

    const inbox = container.querySelector('[data-slot="inbox"]')
    expect(inbox).toHaveAttribute("data-view", "detail")
    expect(
      screen.queryByRole("navigation", { name: "Review queues" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("region", { name: "Review list" })
    ).not.toBeInTheDocument()
    // Hidden, not unmounted: the selected row keeps its aria-current.
    expect(
      container.querySelector('[data-slot="review-row"][aria-current="true"]')
    ).not.toBeNull()
    expect(
      screen.getByRole("region", { name: "Selected review" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Back to reviews" })
    ).toHaveFocus()
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
