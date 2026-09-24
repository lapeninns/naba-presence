import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ReviewDetail } from "@/components/inbox/review-detail"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as connHealthHook from "@/lib/queries/use-connection-health"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"

function fakeDetail(value: Partial<UseQueryResult<ReviewDetailData>>) {
  vi.spyOn(detailHook, "useReviewDetail").mockReturnValue(
    value as UseQueryResult<ReviewDetailData>
  )
}

/**
 * The pane asks the query client which reply mutations are in flight
 * (`useReplyPending` → `useIsMutating`), so it cannot mount without a provider
 * even though every query it reads is stubbed. Retries stay off so an error
 * path settles immediately rather than leaving a query pending.
 */
function renderPane(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const detail: ReviewDetailData = {
  review: {
    id: "rev-1",
    reviewerDisplayName: "Sam Traveller",
    reviewerIsAnonymous: false,
    reviewerProfilePhotoUrl: null,
    rating: 2,
    text: "Slow service at breakfast.",
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
        body: "We are sorry to hear that.",
        bodyBytes: 26,
        evidenceHash: "h",
        modelName: "gpt",
        verificationStatus: "warn",
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

function reviewWith(
  overrides: Partial<ReviewDetailData["review"]>
): ReviewDetailData {
  return { review: { ...detail.review, ...overrides } }
}

/**
 * A review the ladder calls ready to publish.
 *
 * `verified` rather than the fixture's `drafted` is load bearing: the status
 * comes from `derivePrimaryAction`, and `verified` is the only workflow state
 * a publish may leave from (lib/domain/workflow.ts). A `drafted` review with a
 * checked draft reads "Cannot be sent yet", which is a different case.
 */
const readyToPublish = reviewWith({ workflowStatus: "verified" })

/** The one status surface, found the way the pane marks it. */
function statusStrip(container: HTMLElement): HTMLElement {
  const strip = container.querySelector<HTMLElement>(
    '[data-slot="reply-status-strip"]'
  )
  if (!strip) throw new Error("the pane rendered no reply status strip")
  return strip
}

beforeEach(() => {
  // ReplyException reads the workspace's Google connection, and the real hook
  // would fetch. "connected" keeps the disconnected exception out of the way
  // of whatever each test is actually about.
  vi.spyOn(connHealthHook, "useConnectionHealth").mockReturnValue({
    status: "connected",
    label: "Live data",
  })
})

afterEach(() => vi.restoreAllMocks())

describe("ReviewDetail", () => {
  it("renders a busy state while the detail query is pending", () => {
    fakeDetail({ isPending: true, isError: false })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it("renders the conversation and the reviewer's words", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByText("Slow service at breakfast.")).toBeInTheDocument()
    expect(screen.getAllByText("Riverside").length).toBeGreaterThan(0)
  })

  it("reads a one-star rating as singular, not '1 stars'", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ rating: 1 }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getAllByLabelText("1 star").length).toBeGreaterThan(0)
    expect(screen.queryByLabelText("1 stars")).not.toBeInTheDocument()
  })

  // The pane used to answer "where has this reply got to" three times over: a
  // five-stage tracker, a situation strip and the footer button, each derived
  // separately and each able to contradict the others. The lifecycle is back
  // as a permanent strip (reference `.lifecycle`), but it is drawn from
  // `deriveLifecycle` and is not a live region: the one spoken status is still
  // the strip on the action bar.
  it("keeps one status surface beside a lifecycle drawn from the review", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      container.querySelector('ol[aria-label="Reply progress"]')
    ).toBeNull()
    const lifecycle = screen.getByRole("list", { name: "Reply lifecycle" })
    expect(within(lifecycle).getAllByRole("listitem")).toHaveLength(5)
    expect(screen.getAllByRole("status")).toHaveLength(1)
  })

  // The status belongs on the action bar beside the action it explains
  // (reference `.actionbar .ab-status`), not in the header: the header answers
  // "whose review is this", and the sentence here is the same
  // `deriveReplyStatus` wording the list row shows in its short form.
  it("states the reply's status on the action bar, not in the header", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)

    const footer = container.querySelector<HTMLElement>(
      '[data-slot="composer-footer"]'
    )
    expect(footer).not.toBeNull()
    const strip = within(footer!).getByRole("status")
    expect(strip).toHaveTextContent("Draft checked · Ready to publish")
    expect(strip).toHaveAttribute("data-slot", "reply-status-strip")

    // The identity header carries the reviewer, the rating, the venue and the
    // age — and nothing about the reply's progress.
    const heading = screen.getByRole("heading", {
      name: "Sam Traveller",
      level: 2,
    })
    const header = heading.closest("div")?.parentElement
    // Confirm we are looking at the identity row before asserting on what it
    // does not say, so a restructure cannot turn this into a check on an empty
    // wrapper that trivially passes.
    expect(header).toHaveTextContent("Riverside")
    expect(header).not.toHaveTextContent("Ready to publish")
  })

  // The old pane printed Google's two-language blob as one paragraph under a
  // single `lang`, so the same sentence appeared to be typed twice.
  it("shows the translation first and keeps the original one click away", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        detectedLanguageCode: "it",
        text: "(Translated by Google) The food is excellent. (Original) Si mangia benissimo.",
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    expect(screen.getByText("The food is excellent.")).toBeInTheDocument()
    expect(screen.queryByText(/Si mangia benissimo/)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Show original" }))
    const original = screen.getByText(/Si mangia benissimo/)
    expect(original).toBeInTheDocument()
    expect(original.closest("blockquote")).toHaveAttribute("lang", "it")
    expect(screen.getByText("Translated from Italian")).toBeInTheDocument()
  })

  // The composer holds the live reply, so repeating it above the field would
  // be the same words twice — exactly what the old pane did.
  it("stays quiet about the live reply when the composer already holds it", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        workflowStatus: "published",
        drafts: [
          {
            ...detail.review.drafts[0]!,
            body: "Sorry about that — we have added staff at breakfast.",
          },
        ],
        reply: {
          id: "reply-1",
          body: "Sorry about that — we have added staff at breakfast.",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.queryByRole("button", { name: /differs from the reply below/ })
    ).not.toBeInTheDocument()
  })

  it("surfaces the live reply, behind a disclosure, when the draft has moved on", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        workflowStatus: "drafted",
        drafts: [
          { ...detail.review.drafts[0]!, body: "A newer, better answer." },
        ],
        reply: {
          id: "reply-1",
          body: "The words that are on Google today.",
          publishStatus: "published",
          googleReplyState: "APPROVED",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    // The lifecycle strip's Published stage says "Live on Google" as its own
    // meta line as well, so this is a "one or more" count.
    expect(screen.getAllByText("Live on Google").length).toBeGreaterThan(0)
    expect(screen.getAllByText("30 Jul, 12:00").length).toBeGreaterThan(0)
    // The thread shows the reply being worked on; what Google displays is
    // one click away above it, collapsed until asked for.
    expect(
      screen.queryByText("The words that are on Google today.")
    ).not.toBeInTheDocument()

    await user.click(
      screen.getByRole("button", { name: /differs from the reply below/ })
    )
    expect(
      screen.getAllByText("The words that are on Google today.")
    ).toHaveLength(1)
  })

  // "Your published reply" was the label for every publish_status, including
  // the five that mean the reply is not on Google.
  it("does not call a reply awaiting approval published", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        workflowStatus: "awaiting_approval",
        drafts: [{ ...detail.review.drafts[0]!, body: "A newer answer." }],
        reply: {
          id: "reply-1",
          body: "Sorry about that.",
          publishStatus: "awaiting_approval",
          googleReplyState: null,
          googlePolicyViolation: null,
          googleReplyUpdatedAt: null,
        },
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    // Named "Reply", not "Your reply": the composer inside it is its own
    // region named by its heading, and two landmarks may not share a name.
    const replySection = screen.getByRole("region", { name: "Reply" })
    expect(screen.getByRole("status")).toHaveTextContent("Approval required")
    expect(
      within(replySection).getByRole("button", {
        name: /differs from the reply below/,
      })
    ).toHaveTextContent("Waiting for approval")
    // "Live on Google" is `describeReplyState`'s label for a confirmed
    // publication and nothing else; a reply still waiting on an approver has
    // no business wearing it anywhere in the reply area.
    expect(within(replySection).queryByText("Live on Google")).toBeNull()
  })

  // `accepted` means Google took the request and has not yet said what became
  // of it, which is a weaker claim than publication and reads as one. The
  // ladder reaches "Reply published" from `published` alone.
  it("calls an accepted reply sent, not published", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        workflowStatus: "published",
        reply: {
          id: "reply-1",
          body: "We are sorry to hear that.",
          publishStatus: "accepted",
          googleReplyState: "PENDING",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    const strip = screen.getByRole("status")
    expect(strip).toHaveTextContent("Sent to Google")
    expect(strip).not.toHaveTextContent("Reply published")
  })

  it("skips media rows that carry neither a thumbnail nor a video", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        media: [
          {
            id: "m1",
            thumbnailUrl: null,
            thumbnailLabel: null,
            videoUrl: null,
          },
          {
            id: "m2",
            thumbnailUrl: "https://example.test/a.jpg",
            thumbnailLabel: "Breakfast buffet",
            videoUrl: null,
          },
        ],
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    // Scoped to the media region: the pane can hold a second list — the
    // exception's lifecycle detail — and an unscoped count would silently
    // start asserting on whichever one came first.
    const media = screen.getByRole("region", { name: /attached photo/ })
    expect(within(media).getAllByRole("listitem")).toHaveLength(1)
    expect(
      screen.getByRole("button", { name: "Open Breakfast buffet" })
    ).toBeInTheDocument()
  })

  it("opens attached media in a lightbox", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        media: [
          {
            id: "m2",
            thumbnailUrl: "https://example.test/a.jpg",
            thumbnailLabel: "Breakfast buffet",
            videoUrl: null,
          },
        ],
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(
      screen.getByRole("button", { name: "Open Breakfast buffet" })
    )
    expect(
      screen.getByRole("dialog", { name: "Breakfast buffet" })
    ).toBeInTheDocument()
    expect(screen.getByAltText("Breakfast buffet")).toBeInTheDocument()
  })

  it("lets operators step through multiple media items in the lightbox", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        media: [
          {
            id: "m1",
            thumbnailUrl: "https://example.test/a.jpg",
            thumbnailLabel: "Breakfast buffet",
            videoUrl: null,
          },
          {
            id: "m2",
            thumbnailUrl: "https://example.test/b.jpg",
            thumbnailLabel: "Lobby",
            videoUrl: null,
          },
        ],
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(
      screen.getByRole("button", { name: "Open Breakfast buffet" })
    )
    expect(screen.getByText("1 of 2")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Next media" }))
    expect(screen.getByRole("dialog", { name: "Lobby" })).toBeInTheDocument()
    expect(screen.getByText("2 of 2")).toBeInTheDocument()
  })

  // The four facts the header drops — the exact date, whether the Google
  // profile is verified, where the draft came from and who touched it — are
  // still one click away rather than gone.
  it("keeps the review's provenance behind the metadata control", async () => {
    const user = userEvent.setup()
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    await user.click(
      screen.getByRole("button", {
        name: "Review details: date, Google profile and reply author",
      })
    )
    expect(screen.getByText("Review received")).toBeInTheDocument()
    expect(screen.getByText("30 Jul, 11:00")).toBeInTheDocument()
    expect(screen.getByText("Google profile")).toBeInTheDocument()
    expect(screen.getByText("Riverside · verified")).toBeInTheDocument()
  })

  // The five-stage tracker used to be permanent chrome on every review,
  // including the majority where nothing had gone wrong. It is now raised only
  // when something is actually in the way, and only behind a disclosure.
  it("raises no exception for a review that is simply ready to publish", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(container.querySelector('[data-slot="reply-exception"]')).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Workflow details" })
    ).not.toBeInTheDocument()
  })

  it("explains a failed publish and marks the stage that failed", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        workflowStatus: "failed",
        reply: {
          id: "reply-1",
          body: "We are sorry to hear that.",
          publishStatus: "failed",
          googleReplyState: null,
          googlePolicyViolation: null,
          googleReplyUpdatedAt: null,
        },
      }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)

    const exception = container.querySelector<HTMLElement>(
      '[data-slot="reply-exception"]'
    )
    expect(exception).not.toBeNull()
    expect(exception).toHaveAttribute("data-tone", "attention")
    expect(within(exception!).getByText("Publish failed")).toBeInTheDocument()
    expect(screen.getByRole("status")).toHaveTextContent("Publish failed")

    // The lifecycle is on screen for every review now, so a failed publish
    // is visible where it happened: the Published stage, as failed.
    const lifecycle = screen.getByRole("list", { name: "Reply lifecycle" })
    const stages = within(lifecycle).getAllByRole("listitem")
    expect(stages).toHaveLength(5)
    expect(stages[4]).toHaveAttribute("data-state", "failed")
    expect(stages[4]).toHaveTextContent("Google rejected it")
    // And no second copy of the stages behind a disclosure.
    expect(
      screen.queryByRole("button", { name: "Workflow details" })
    ).not.toBeInTheDocument()
  })

  it("keeps a footer action skeleton while the detail is loading", () => {
    fakeDetail({ isPending: true, isError: false })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    expect(
      screen.queryByRole("button", { name: "Publish reply" })
    ).not.toBeInTheDocument()
    expect(container.querySelector("footer")).not.toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  // The success signal must outlive the event tick: InboxView waits the same
  // PUBLISH_PULSE_MS before navigating away, so this is what the operator
  // actually sees between "Publish" and the next review.
  //
  // Asserted through `data-pulse` rather than the ring class it currently
  // draws. Whether the celebration is a ring, a tint or a glow is a design
  // decision that may change; that the strip marks itself as pulsing for the
  // shared duration is the behaviour, and a restyle should not fail this test.
  it("pulses the status strip for the shared pulse duration after a publish", () => {
    vi.useFakeTimers()
    try {
      fakeDetail({ isPending: false, isError: false, data: detail })
      const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
      const strip = statusStrip(container)
      expect(strip).not.toHaveAttribute("data-pulse")

      // Another review's publish is not this strip's business.
      act(() => {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, {
            detail: { reviewId: "rev-9" },
          })
        )
      })
      expect(strip).not.toHaveAttribute("data-pulse")

      act(() => {
        window.dispatchEvent(
          new CustomEvent(PUBLISH_PULSE_EVENT, {
            detail: { reviewId: "rev-1" },
          })
        )
      })
      expect(strip).toHaveAttribute("data-pulse", "true")

      act(() => {
        vi.advanceTimersByTime(PUBLISH_PULSE_MS - 1)
      })
      expect(strip).toHaveAttribute("data-pulse", "true")

      act(() => {
        vi.advanceTimersByTime(1)
      })
      expect(strip).not.toHaveAttribute("data-pulse")
    } finally {
      vi.useRealTimers()
    }
  })

  it("says so plainly when there is a rating but no written review", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ text: null }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.getByText("A rating with no written review.")
    ).toBeInTheDocument()
  })
})
