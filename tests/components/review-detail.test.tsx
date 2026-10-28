import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { useEffect, type ReactElement } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DetailErrorBoundary } from "@/components/inbox/detail-error-boundary"
import {
  DirtyGuardProvider,
  useRegisterDirtyGuard,
} from "@/components/inbox/dirty-context"
import { ReviewDetail } from "@/components/inbox/review-detail"
import { ApiClientError } from "@/lib/api/client"
import { replyMutationKey } from "@/lib/queries/use-reply-pending"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as connHealthHook from "@/lib/queries/use-connection-health"
import * as sessionHook from "@/lib/queries/use-session"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"
import * as membersHook from "@/lib/queries/use-members"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import { Toaster } from "@/components/ui/toast"
import { PUBLISH_PULSE_EVENT, PUBLISH_PULSE_MS } from "@/lib/inbox/events"

function stubSession(role: string, isError = false) {
  vi.spyOn(sessionHook, "useSession").mockReturnValue({
    data: isError ? undefined : { session: { userId: "me-1", role } },
    isError,
  } as unknown as ReturnType<typeof sessionHook.useSession>)
}

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
  return render(
    <QueryClientProvider client={client}>
      <Toaster>{ui}</Toaster>
    </QueryClientProvider>
  )
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
  // The connection link is for owners and admins only (INB-06).
  vi.spyOn(sessionHook, "useSessionRole").mockReturnValue("owner")
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
    // The reply is written as the listing, and says so at its head.
    expect(
      screen.getByRole("heading", { name: "Reply as Riverside", level: 2 })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("region", { name: "Your reply" })
    ).toHaveTextContent("Private until you publish")
  })

  // One conversation: the reviewer's avatar joined by a rail to the
  // listing's, the review above the reply.
  it("draws the review and the reply as one thread", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const thread = container.querySelector<HTMLElement>(
      '[data-slot="review-thread"]'
    )
    expect(thread).not.toBeNull()
    const review = thread!.querySelector('[data-slot="thread-review"]')
    const reply = thread!.querySelector('[data-slot="thread-reply"]')
    expect(review?.querySelector('[data-slot="avatar"]')).toHaveTextContent(
      "ST"
    )
    expect(review?.querySelector('[data-slot="thread-rail"]')).not.toBeNull()
    expect(reply?.querySelector('[data-slot="avatar"]')).toHaveTextContent("R")
    // Review first, then reply, in reading order.
    expect(
      review!.compareDocumentPosition(reply!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  // Which venue the review is for is always on screen: the location for a
  // business, the client first for an agency.
  it("names the venue under the reviewer, client first when there is one", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container, unmount } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      container.querySelector('[data-slot="review-venue"]')
    ).toHaveTextContent(/^Riverside$/)
    unmount()

    const agency = renderPane(
      <ReviewDetail reviewId="rev-1" clientName="Old Crown Group" />
    )
    expect(
      agency.container.querySelector('[data-slot="review-venue"]')
    ).toHaveTextContent(/^Old Crown Group · Riverside$/)
  })

  // A message header (avatar beside the name) over words that span the
  // whole column; the rail stays in the DOM but is not drawn, and one
  // hairline separates the review from the reply.
  it("lays each thread item out as a header row over a full-width body", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const review = container.querySelector<HTMLElement>(
      '[data-slot="thread-review"]'
    )!
    expect(review).toHaveClass("border-b", "border-line-subtle", "pb-8")
    expect(review.querySelector('[data-slot="thread-rail"]')).toHaveClass(
      "hidden"
    )
    const words = screen.getByText("Slow service at breakfast.")
    expect(words.closest(".col-span-2")?.parentElement).toBe(review)
    const reply = container.querySelector<HTMLElement>(
      '[data-slot="thread-reply"]'
    )!
    expect(
      within(reply).getByRole("heading", { name: "Reply as Riverside" })
        .parentElement?.parentElement
    ).toBe(reply)
  })

  it("gives an anonymous reviewer no initials", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ reviewerIsAnonymous: true }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const avatar = container.querySelector(
      '[data-slot="thread-review"] [data-slot="avatar"]'
    )
    expect(avatar).not.toBeNull()
    expect(avatar!.textContent?.trim()).toBe("")
    // A person glyph stands in for the initials.
    expect(avatar!.querySelector("svg")).not.toBeNull()
    expect(
      screen.getByRole("heading", { name: "Anonymous", level: 2 })
    ).toBeInTheDocument()
  })

  // Who, in one line under the name: stars, when, and that it is a Google
  // review. The venue has its own line under it (see "names the venue …").
  it("reads the rating in the thread's meta line", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ rating: 4 }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const meta = container.querySelector<HTMLElement>(
      '[data-slot="review-meta"]'
    )
    expect(meta).not.toBeNull()
    expect(within(meta!).getByRole("img")).toHaveAccessibleName(
      "Rated 4 out of 5"
    )
    expect(meta).toHaveTextContent("Google review")
    expect(meta).not.toHaveTextContent("Riverside")
  })

  // The pane used to answer "where has this reply got to" three times over.
  // The footer status is the one spoken surface. The five-stage lifecycle
  // is not drawn on the reply pane.
  it("keeps one status surface and does not draw a lifecycle", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      container.querySelector('ol[aria-label="Reply progress"]')
    ).toBeNull()
    expect(
      screen.queryByRole("list", { name: "Reply lifecycle" })
    ).not.toBeInTheDocument()
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

    // The identity header carries the reviewer, the rating, the age and the
    // source — and nothing about the reply's progress.
    const heading = screen.getByRole("heading", {
      name: "Sam Traveller",
      level: 2,
    })
    const header = heading.closest("div")?.parentElement
    // Confirm we are looking at the identity row before asserting on what it
    // does not say, so a restructure cannot turn this into a check on an empty
    // wrapper that trivially passes.
    expect(header).toHaveTextContent("Google review")
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

  // INB-01: Google holds the live reply for moderation, so nothing on screen
  // may call it live while a newer draft is in the composer.
  it("does not say Live on Google while Google is still checking the live reply", () => {
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
          googleReplyState: "PENDING",
          googlePolicyViolation: null,
          googleReplyUpdatedAt: "2026-07-30T11:00:00.000Z",
        },
      }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const disclosure = screen.getByRole("button", {
      name: /differs from the reply below/,
    })
    expect(disclosure).toHaveTextContent(/waiting for Google.s check/)
    expect(disclosure).not.toHaveTextContent(/Live on Google/)
    expect(
      container.querySelector('[data-slot="reply-heading"] + p')
    ).toHaveTextContent(
      /waiting for Google.s check · your newer draft is not published yet/
    )
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

    const replySection = screen.getByRole("region", { name: "Your reply" })
    expect(screen.getByRole("status")).toHaveTextContent(
      "Waiting for your approval"
    )
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
  // ladder reaches "Live on Google" from `published` alone.
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
    expect(strip).toHaveTextContent(
      "Sent to Google · not live until Google confirms"
    )
    expect(strip).not.toHaveTextContent("Live on Google")
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
  // still reachable from ⋯ rather than gone.
  it("keeps the review's provenance behind ⋯ → Review details", async () => {
    const user = userEvent.setup()
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Review details" })
    )
    // The loading shell shares the loaded dialog's name, so wait for the
    // loaded content and re-acquire the dialog rather than keep the shell.
    await waitFor(() => {
      const dialog = screen.getByRole("dialog", { name: "Review details" })
      expect(within(dialog).getByText("Review received")).toBeInTheDocument()
    })
    expect(screen.getByText("30 Jul, 11:00")).toBeInTheDocument()
    expect(screen.getByText("Listing")).toBeInTheDocument()
    expect(
      screen.getByText("Riverside · verified on Google")
    ).toBeInTheDocument()
  })

  // The drafts route writes `review.draft.edited` / `review.draft.generated`;
  // the dialog used to look for keys nothing writes and said "Not recorded".
  it("names who last saved the draft, from the audit trail", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        timeline: [
          {
            action: "review.draft.edited",
            createdAt: "2026-07-30T10:06:00.000Z",
            actorName: "Aman",
            metadataSummary: null,
          },
        ],
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(
      await screen.findByRole("menuitem", { name: "Review details" })
    )
    await waitFor(() => {
      const dialog = screen.getByRole("dialog", { name: "Review details" })
      expect(
        within(dialog).getByText("Draft last saved by")
      ).toBeInTheDocument()
    })
    const dialog = screen.getByRole("dialog", { name: "Review details" })
    const row = within(dialog).getByText("Draft last saved by").parentElement
    expect(row).toHaveTextContent("Aman")
    expect(dialog).not.toHaveTextContent("Not recorded")
  })

  it("opens the review's history from ⋯ → History", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        timeline: [
          {
            action: "review.draft.generated",
            createdAt: "2026-07-30T10:05:00.000Z",
            actorName: "Aman",
            metadataSummary: null,
          },
        ],
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)

    // Not on the pane itself any more.
    expect(screen.queryByText("Draft generated")).not.toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await user.click(await screen.findByRole("menuitem", { name: "History" }))
    const dialog = await screen.findByRole("dialog", { name: "History" })
    expect(within(dialog).getByText("Draft generated")).toBeInTheDocument()
  })

  // INB-08: triaging one review no longer goes through Select mode. The
  // review's own ⋯ carries "No reply needed" and "Assign…", so it takes the
  // menu and the action (two taps, with Undo in the toast), and an assignment
  // takes the menu and the person.
  describe("triage from ⋯", () => {
    const mutateAsync = vi.fn<(input: unknown) => Promise<unknown>>(
      async () => ({
        results: [
          {
            reviewId: "rev-1",
            status: "ok",
            triagedAt: "2026-10-16T07:00:00.000001Z",
          },
        ],
      })
    )

    beforeEach(() => {
      mutateAsync.mockClear()
      vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
        mutateAsync,
        isPending: false,
      } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
      stubSession("owner")
      vi.spyOn(membersHook, "useMembers").mockReturnValue({
        data: {
          members: [
            {
              userId: "u1",
              displayName: "Priya",
              email: "p@example.test",
              role: "member",
              locations: [],
            },
            {
              userId: "u2",
              displayName: "Vic",
              email: "v@example.test",
              role: "viewer",
              locations: [],
            },
            {
              userId: "u3",
              displayName: "Sol",
              email: "s@example.test",
              role: "member",
              locations: [{ locationId: "elsewhere", canPublish: true }],
            },
          ],
        },
      } as unknown as ReturnType<typeof membersHook.useMembers>)
    })

    afterEach(() => vi.unstubAllGlobals())

    it("marks the review as needing no reply from ⋯ at once, and Undo puts it back", async () => {
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(
        await screen.findByRole("menuitem", { name: "No reply needed" })
      )
      // No question first: it is sent, and the toast carries the way back.
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
      expect(mutateAsync).toHaveBeenCalledWith({
        action: "mark_reviewed",
        reviewIds: ["rev-1"],
      })
      await user.click(await screen.findByRole("button", { name: "Undo" }))
      await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
      expect(mutateAsync).toHaveBeenLastCalledWith({
        action: "mark_unreviewed",
        marks: [
          { reviewId: "rev-1", triagedAt: "2026-10-16T07:00:00.000001Z" },
        ],
      })
    })

    it("says why nothing changed when the review was already marked, with no Undo", async () => {
      const user = userEvent.setup()
      mutateAsync.mockResolvedValueOnce({
        results: [
          {
            reviewId: "rev-1",
            status: "skipped",
            code: "review_already_triaged",
          },
        ],
      })
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)
      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(
        await screen.findByRole("menuitem", { name: "No reply needed" })
      )
      expect(await screen.findByText("Nothing changed")).toBeInTheDocument()
      expect(
        screen.getByText("That review was already marked as no reply needed.")
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("button", { name: "Undo" })
      ).not.toBeInTheDocument()
    })

    it("assigns the review from ⋯ → Assign…, to people it could be offered to", async () => {
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      // Never a viewer, and never a member scoped away from this location.
      expect(
        await screen.findByRole("menuitem", { name: "Priya" })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Vic" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Sol" })
      ).not.toBeInTheDocument()
      // By keyboard: jsdom has no layout, so Base UI's submenu ignores a
      // synthetic pointer that never "travelled" into it.
      screen.getByRole("menuitem", { name: "Priya" }).focus()
      await user.keyboard("{Enter}")
      expect(mutateAsync).toHaveBeenCalledWith({
        action: "assign",
        reviewIds: ["rev-1"],
        assigneeId: "u1",
      })
      // The toast names who, not "1 review updated".
      expect(await screen.findByText("Assigned to Priya")).toBeInTheDocument()
    })

    it("says Unassigned when the review is assigned to no one", async () => {
      const user = userEvent.setup()
      mutateAsync.mockResolvedValueOnce({
        results: [{ reviewId: "rev-1", status: "ok" }],
      })
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)
      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      ;(await screen.findByRole("menuitem", { name: "Unassign" })).focus()
      await user.keyboard("{Enter}")
      expect(await screen.findByText("Unassigned")).toBeInTheDocument()
      expect(screen.queryByText(/review updated/)).not.toBeInTheDocument()
    })

    it("gives the real reason when the person cannot take the review", async () => {
      const user = userEvent.setup()
      mutateAsync.mockResolvedValueOnce({
        results: [
          {
            reviewId: "rev-1",
            status: "skipped",
            code: "assignee_not_eligible",
          },
        ],
      })
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)
      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      ;(await screen.findByRole("menuitem", { name: "Priya" })).focus()
      await user.keyboard("{Enter}")
      expect(await screen.findByText("Nothing changed")).toBeInTheDocument()
      expect(
        screen.getByText(
          "That person can’t work on reviews at this location, so it wasn’t assigned to them."
        )
      ).toBeInTheDocument()
    })

    it("says a failed row in its own words, with no bar to point at", async () => {
      const user = userEvent.setup()
      mutateAsync.mockResolvedValueOnce({
        results: [
          { reviewId: "rev-1", status: "failed", code: "bulk_row_failed" },
        ],
      })
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)
      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(
        await screen.findByRole("menuitem", { name: "No reply needed" })
      )
      expect(
        await screen.findByText("That review was not updated")
      ).toBeInTheDocument()
      expect(screen.queryByText(/The bar lists/)).not.toBeInTheDocument()
    })

    it("offers no No reply needed on a reply that is live on Google", async () => {
      const user = userEvent.setup()
      fakeDetail({
        isPending: false,
        isError: false,
        data: reviewWith({ workflowStatus: "published" }),
      })
      renderPane(<ReviewDetail reviewId="rev-1" />)
      await user.click(screen.getByRole("button", { name: "More actions" }))
      expect(
        await screen.findByRole("menuitem", { name: "Assign…" })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "No reply needed" })
      ).not.toBeInTheDocument()
    })

    // /api/members is for owners and admins to read. A member may still
    // assign at a location they can edit, so the menu must not depend on it.
    it("offers an ordinary member themselves and Unassign, without reading the team", async () => {
      stubSession("member")
      const members = vi.spyOn(membersHook, "useMembers")
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      const me = await screen.findByRole("menuitem", { name: "Me" })
      expect(
        screen.queryByRole("menuitem", { name: "Priya" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: /Couldn't load people/ })
      ).not.toBeInTheDocument()
      expect(members).toHaveBeenCalledWith({ enabled: false })
      expect(members).not.toHaveBeenCalledWith({ enabled: true })
      me.focus()
      await user.keyboard("{Enter}")
      expect(mutateAsync).toHaveBeenCalledWith({
        action: "assign",
        reviewIds: ["rev-1"],
        assigneeId: "me-1",
      })
      expect(await screen.findByText("Assigned to you")).toBeInTheDocument()
    })

    it("says so when an admin's team list cannot be loaded", async () => {
      stubSession("admin")
      vi.spyOn(membersHook, "useMembers").mockReturnValue({
        data: undefined,
        isError: true,
      } as unknown as ReturnType<typeof membersHook.useMembers>)
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      expect(
        await screen.findByRole("menuitem", { name: "Couldn't load people" })
      ).toHaveAttribute("aria-disabled", "true")
      // Unassign needs no list, so it stays on offer.
      expect(
        screen.getByRole("menuitem", { name: "Unassign" })
      ).toBeInTheDocument()
    })

    it("says the people are loading while an admin's team list is on its way", async () => {
      stubSession("admin")
      vi.spyOn(membersHook, "useMembers").mockReturnValue({
        data: undefined,
        isError: false,
      } as unknown as ReturnType<typeof membersHook.useMembers>)
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await user.click(await screen.findByRole("menuitem", { name: "Assign…" }))
      expect(
        await screen.findByRole("menuitem", { name: "Loading people…" })
      ).toHaveAttribute("aria-disabled", "true")
    })

    it("lists the people in the sheet on a phone, where a submenu has nowhere to fly", async () => {
      vi.stubGlobal("matchMedia", (query: string) => ({
        matches: query === PHONE_OVERLAY_QUERY,
        media: query,
        onchange: null,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }))
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      expect(
        await screen.findByRole("menuitem", { name: "No reply needed" })
      ).toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Assign…" })
      ).not.toBeInTheDocument()
      await user.click(
        await screen.findByRole("menuitem", { name: "Unassign" })
      )
      expect(mutateAsync).toHaveBeenCalledWith({
        action: "assign",
        reviewIds: ["rev-1"],
        assigneeId: null,
      })
    })

    // The same gate as the bulk tools: a viewer cannot assign or mark.
    it("offers a viewer neither", async () => {
      vi.spyOn(sessionHook, "useSessionRole").mockReturnValue("viewer")
      const user = userEvent.setup()
      fakeDetail({ isPending: false, isError: false, data: detail })
      renderPane(<ReviewDetail reviewId="rev-1" />)

      await user.click(screen.getByRole("button", { name: "More actions" }))
      await screen.findByRole("menuitem", { name: "Open listing" })
      expect(
        screen.queryByRole("menuitem", { name: "No reply needed" })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole("menuitem", { name: "Assign…" })
      ).not.toBeInTheDocument()
    })
  })

  it("links to the listing from ⋯", async () => {
    const user = userEvent.setup()
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    expect(
      await screen.findByRole("menuitem", { name: "Open listing" })
    ).toHaveAttribute("href", "/listings/loc-1")
  })

  it("links to the review on Google from ⋯ when Google gave a reply link", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        googleReplyUrl: "https://business.google.com/reviews/reply/abc",
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    const link = await screen.findByRole("menuitem", { name: "Open on Google" })
    expect(link).toHaveAttribute(
      "href",
      "https://business.google.com/reviews/reply/abc"
    )
    expect(link).toHaveAttribute("target", "_blank")
  })

  it("offers no Google link when the payload had none", async () => {
    const user = userEvent.setup()
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    await user.click(screen.getByRole("button", { name: "More actions" }))
    await screen.findByRole("menuitem", { name: "Open listing" })
    expect(
      screen.queryByRole("menuitem", { name: "Open on Google" })
    ).not.toBeInTheDocument()
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
    expect(
      screen.queryByRole("list", { name: "Reply lifecycle" })
    ).not.toBeInTheDocument()
  })

  // One sentence and a Settings link used to answer every failed publish.
  // The link now appears only when the connection is the cause.
  it.each([
    [
      "google_reconnect_required",
      "Google connection for this listing stopped working",
      true,
    ],
    ["INVALID_ARGUMENT", "Google refused the reply as written", false],
    ["google_timeout", "Google did not answer in time", false],
  ])(
    "words a failed publish by its cause (%s)",
    (lastErrorCode, sentence, link) => {
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
            lastErrorCode,
          },
        }),
      })
      const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
      const exception = container.querySelector<HTMLElement>(
        '[data-slot="reply-exception"]'
      )!
      expect(exception).toHaveTextContent(sentence)
      if (link) {
        expect(
          within(exception).getByRole("link", {
            name: "Check Google connections",
          })
        ).toBeInTheDocument()
      } else {
        expect(
          within(exception).queryByRole("link", {
            name: "Check Google connections",
          })
        ).not.toBeInTheDocument()
      }
    }
  )

  it("shows a member the connection failure without a link to Access denied", () => {
    vi.spyOn(sessionHook, "useSessionRole").mockReturnValue("member")
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
          lastErrorCode: "google_reconnect_required",
        },
      }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const exception = container.querySelector<HTMLElement>(
      '[data-slot="reply-exception"]'
    )!
    expect(exception).toHaveTextContent(
      "Ask an owner or admin to reconnect Google"
    )
    expect(
      within(exception).queryByRole("link", {
        name: "Check Google connections",
      })
    ).not.toBeInTheDocument()
  })

  it("does not draw a lifecycle on a review with no draft", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ workflowStatus: "new", drafts: [] }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(screen.getByRole("status")).toHaveTextContent("No reply yet")
    expect(
      screen.queryByRole("list", { name: "Reply lifecycle" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: "Verification" })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole("heading", { name: /^Activity/ })
    ).not.toBeInTheDocument()
  })

  it("notes when the reviewer edited the review after writing it", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ updateTime: "2026-08-02T10:00:00.000Z" }),
    })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      container.querySelector('time[datetime="2026-08-02T10:00:00.000Z"]')
    ).toHaveTextContent(/edited/)
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
    // Docked from the first paint, as the loaded bar will be, so the tab bar
    // does not show and then step aside.
    const footer = container.querySelector('[data-slot="composer-footer"]')
    expect(footer).toHaveAttribute("data-docked", "bottom")
    expect(footer).toHaveAttribute("aria-hidden", "true")
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

// Below lg the review has replaced the list. The way back is the shell's app
// bar, so the review has no head band of its own: the reviewer's name is the
// page's h1, with the steps and the ⋯ menu on its row and the position beside
// the venue.
describe("ReviewDetail — below lg", () => {
  it("names the reviewer once, in the h1, with no head band", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(
      <ReviewDetail reviewId="rev-1" titleIsHeading />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Sam Traveller" })
    ).toHaveAttribute("data-slot", "review-heading")
    expect(screen.getAllByText("Sam Traveller")).toHaveLength(1)
    expect(container.querySelector('[data-slot="review-head"]')).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Back to Inbox" })
    ).not.toBeInTheDocument()
  })

  it("keeps the name an h2 where the list is beside the review", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.getByRole("heading", { level: 2, name: "Sam Traveller" })
    ).toBeInTheDocument()
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument()
  })

  it("puts the steps beside the ⋯ menu on the name's row", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        titleIsHeading
        nav={{ position: 2, total: 5, more: false, onPrevious: vi.fn() }}
      />
    )
    const name = container.querySelector('[data-slot="review-heading"]')
    const steps = container.querySelector<HTMLElement>(
      '[data-slot="review-steps"]'
    )
    expect(steps).not.toBeNull()
    expect(steps!.parentElement).toBe(name!.parentElement)
    expect(
      within(steps!).getByRole("button", { name: "Previous review" })
    ).toBeEnabled()
    expect(
      within(steps!).getByRole("button", { name: "Next review" })
    ).toBeDisabled()
    expect(
      within(name!.parentElement as HTMLElement).getByRole("button", {
        name: "More actions",
      })
    ).toBeInTheDocument()
    expect(
      container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("Review 2 of 5")
  })

  it("keeps the same heading from loading to loaded", () => {
    fakeDetail({ isPending: true, isError: false })
    const client = new QueryClient()
    const view = render(
      <QueryClientProvider client={client}>
        <ReviewDetail reviewId="rev-1" heading="Sam T." titleIsHeading />
      </QueryClientProvider>
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Sam T." })
    ).toBeInTheDocument()
    fakeDetail({ isPending: false, isError: false, data: detail })
    view.rerender(
      <QueryClientProvider client={client}>
        <ReviewDetail reviewId="rev-1" heading="Sam T." titleIsHeading />
      </QueryClientProvider>
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Sam Traveller" })
    ).toBeInTheDocument()
    expect(document.querySelectorAll("h1")).toHaveLength(1)
  })

  it("still has an h1 while loading a review the list did not name", () => {
    fakeDetail({ isPending: true, isError: false })
    renderPane(<ReviewDetail reviewId="rev-1" titleIsHeading />)
    expect(document.querySelectorAll("h1")).toHaveLength(1)
  })

  it("keeps an h1 and a retry when the review fails to load", () => {
    fakeDetail({
      isPending: false,
      isError: true,
      error: new Error("boom"),
      refetch: vi.fn(),
    } as Partial<UseQueryResult<ReviewDetailData>>)
    renderPane(
      <ReviewDetail reviewId="rev-1" heading="Sam T." titleIsHeading />
    )
    expect(
      screen.getByRole("heading", { level: 1, name: "Sam T." })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Try again/ })
    ).toBeInTheDocument()
  })

  it("says where the review sits and steps either way", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const onPrevious = vi.fn()
    const onNext = vi.fn()
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        nav={{ position: 2, total: 7, more: false, onPrevious, onNext }}
      />
    )
    const position = container.querySelector('[data-slot="review-position"]')
    expect(position).toHaveTextContent("Review 2 of 7")
    screen.getByRole("button", { name: "Previous review" }).click()
    screen.getByRole("button", { name: "Next review" }).click()
    expect(onPrevious).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it("turns the steps off at the ends and says 50+ when more follow", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        nav={{ position: 1, total: 50, more: true }}
      />
    )
    expect(
      container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("1 of 50+")
    expect(
      screen.getByRole("button", { name: "Previous review" })
    ).toBeDisabled()
    expect(screen.getByRole("button", { name: "Next review" })).toBeDisabled()
  })

  it("keeps the steps and position while the review loads or fails", () => {
    const nav = { position: 2, total: 7, more: false, onNext: vi.fn() }
    fakeDetail({ isPending: true, isError: false })
    const loading = renderPane(
      <ReviewDetail reviewId="rev-2" heading="Sam T." nav={nav} />
    )
    expect(
      loading.container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("Review 2 of 7")
    expect(screen.getByRole("button", { name: "Next review" })).toBeEnabled()
    loading.unmount()

    fakeDetail({ isPending: false, isError: true, error: new Error("nope") })
    const failed = renderPane(
      <ReviewDetail reviewId="rev-2" heading="Sam T." nav={nav} />
    )
    expect(
      failed.container.querySelector('[data-slot="review-position"]')
    ).toHaveTextContent("Review 2 of 7")
    expect(screen.getByRole("button", { name: "Next review" })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: /Try again/ })
    ).toBeInTheDocument()
  })

  it("draws no steps or position without a place in the list", () => {
    fakeDetail({ isPending: false, isError: false, data: detail })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(container.querySelector('[data-slot="review-steps"]')).toBeNull()
    expect(container.querySelector('[data-slot="review-position"]')).toBeNull()
  })
})

describe("ReviewDetail — photos that will not load", () => {
  const photos = reviewWith({
    media: [
      {
        id: "m1",
        thumbnailUrl: "https://lh3.googleusercontent.com/gone.jpg",
        videoUrl: null,
        thumbnailLabel: null,
      },
    ],
  })

  it("swaps a failed thumbnail for a placeholder instead of the broken glyph", () => {
    fakeDetail({ isPending: false, isError: false, data: photos })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const tile = screen.getByRole("button", { name: "Open Review photo" })
    const image = tile.querySelector("img")
    expect(image).not.toBeNull()
    act(() => {
      image!.dispatchEvent(new Event("error"))
    })
    expect(tile.querySelector("img")).toBeNull()
    const placeholder = container.querySelector(
      '[data-slot="media-unavailable"]'
    )
    expect(placeholder).toHaveAttribute("title", "Photo unavailable")
    expect(placeholder?.querySelector("svg")).not.toBeNull()
    // Said in words, on the tile and to a screen reader, not only in a
    // tooltip a thumb cannot reach.
    expect(placeholder).toHaveTextContent("Photo unavailable")
    expect(tile).toHaveAccessibleName("Open Review photo")
    expect(tile).toHaveAccessibleDescription("Photo unavailable")
    // The tile is still there to open.
    expect(tile).toBeEnabled()
  })

  it("explains a failed photo in the lightbox and offers the review on Google", async () => {
    const user = userEvent.setup()
    fakeDetail({
      isPending: false,
      isError: false,
      data: {
        review: {
          ...photos.review,
          googleReplyUrl: "https://maps.google.com/review/1",
        },
      },
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    const tile = screen.getByRole("button", { name: "Open Review photo" })
    act(() => {
      tile.querySelector("img")!.dispatchEvent(new Event("error"))
    })
    await user.click(tile)
    const lightbox = await screen.findByRole("dialog", { name: "Review photo" })
    expect(lightbox).toHaveTextContent(
      "This photo could not be loaded. Google may have moved or removed it."
    )
    expect(
      within(lightbox).getByRole("link", { name: "Open on Google" })
    ).toHaveAttribute("href", "https://maps.google.com/review/1")
  })
})

describe("ReviewDetail — photos that failed before hydration", () => {
  it("shows the placeholder for an image that has already finished with no pixels", () => {
    // A server-rendered image can fail before React attaches `onError`.
    const complete = vi
      .spyOn(HTMLImageElement.prototype, "complete", "get")
      .mockReturnValue(true)
    // jsdom never selects a source; a browser has one by the time it fails.
    const currentSrc = vi
      .spyOn(HTMLImageElement.prototype, "currentSrc", "get")
      .mockReturnValue("https://lh3.googleusercontent.com/gone.jpg")
    try {
      fakeDetail({
        isPending: false,
        isError: false,
        data: reviewWith({
          media: [
            {
              id: "m1",
              thumbnailUrl: "https://lh3.googleusercontent.com/gone.jpg",
              videoUrl: null,
              thumbnailLabel: null,
            },
          ],
        }),
      })
      const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
      const tile = screen.getByRole("button", { name: "Open Review photo" })
      expect(tile.querySelector("img")).toBeNull()
      expect(
        container.querySelector('[data-slot="media-unavailable"]')
      ).toHaveAttribute("title", "Photo unavailable")
    } finally {
      complete.mockRestore()
      currentSrc.mockRestore()
    }
  })
})

describe("ReviewDetail — publish bar", () => {
  it("docks the bar to the bottom when it carries actions", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    const footer = container.querySelector('[data-slot="composer-footer"]')
    expect(footer).toHaveAttribute("data-docked", "bottom")
    expect(
      within(footer as HTMLElement).getByRole("button", {
        name: "Publish reply",
      })
    ).toBeInTheDocument()
    // The shared ActionBar's dock: a named region, fixed on a phone, with
    // an in-flow spacer that keeps the reply reachable above it.
    expect(footer).toHaveAttribute("role", "region")
    expect(footer).toHaveAccessibleName("Reply actions")
    expect(footer?.className).toMatch(/max-md:fixed/)
    expect(
      container.querySelector('[data-slot="action-bar-spacer"]')
    ).not.toBeNull()
  })

  it("keeps the bar undocked when it has no actions", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const footer = container.querySelector('[data-slot="composer-footer"]')
    expect(footer).not.toBeNull()
    expect(footer).not.toHaveAttribute("data-docked")
    expect(
      container.querySelector('[data-slot="action-bar-spacer"]')
    ).toBeNull()
  })

  // The primary in the inbox's bar reaches Google (or asks for the approval
  // that will), so the bar is the one charcoal bar, and the status words on
  // it take the on-charcoal inks.
  it("draws the bar charcoal when it carries actions, with on-charcoal status words", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    const footer = container.querySelector('[data-slot="composer-footer"]')
    expect(footer).toHaveAttribute("data-bar-tone", "charcoal")
    expect(footer).not.toHaveClass("bg-surface")
    const line = footer!.querySelector('[data-slot="reply-status"]')
    expect(line).toHaveClass("text-ink-on-charcoal")
    expect(line).not.toHaveClass("text-ink")
  })

  it("keeps the plain surface bar without actions and while loading", () => {
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container, unmount } = renderPane(<ReviewDetail reviewId="rev-1" />)
    const footer = container.querySelector('[data-slot="composer-footer"]')
    expect(footer).toHaveAttribute("data-bar-tone", "surface")
    expect(footer!.querySelector('[data-slot="reply-status"]')).toHaveClass(
      "text-ink"
    )
    unmount()

    fakeDetail({ isPending: true, isError: false })
    const loading = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    expect(
      loading.container.querySelector('[data-slot="composer-footer"]')
    ).toHaveAttribute("data-bar-tone", "surface")
  })

  it("gives a viewer no bar, the status inline and a note", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        capabilities: {
          canPublish: false,
          canEdit: false,
          canRequestApproval: false,
        },
      }),
    })
    const { container } = renderPane(
      <ReviewDetail
        reviewId="rev-1"
        actions={<button type="button">Publish reply</button>}
      />
    )
    expect(container.querySelector('[data-slot="composer-footer"]')).toBeNull()
    expect(container.querySelector('[data-docked="bottom"]')).toBeNull()
    expect(
      screen.queryByRole("button", { name: "Publish reply" })
    ).not.toBeInTheDocument()
    const reply = screen.getByRole("region", { name: "Your reply" })
    expect(within(reply).getByRole("status")).toBeInTheDocument()
    expect(reply).toHaveTextContent(
      "View-only access for this location. You can read the review and its reply; ask an owner or admin for reply access."
    )
  })
})

describe("DetailErrorBoundary", () => {
  function Boom(): never {
    throw new Error("render failed")
  }

  it("offers Try again and, given a way back, Back to Inbox", () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const onBack = vi.fn()
    render(
      <DetailErrorBoundary onBack={onBack}>
        <Boom />
      </DetailErrorBoundary>
    )
    expect(
      screen.getByText("This review could not be shown.")
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Try again" })
    ).toBeInTheDocument()
    screen.getByRole("button", { name: "Back to Inbox" }).click()
    expect(onBack).toHaveBeenCalledTimes(1)
  })
})

// p5 F03/F04/F05: what the publish bar and the pane say, and what they offer.
describe("ReviewDetail — the bar says what to do next", () => {
  function failedWith(
    lastErrorCode: string | null,
    violation: string | null = null
  ) {
    return reviewWith({
      workflowStatus: "failed",
      reply: {
        id: "reply-1",
        body: "We are sorry to hear that.",
        publishStatus: "failed",
        googleReplyState: null,
        googlePolicyViolation: violation,
        googleReplyUpdatedAt: null,
        lastErrorCode,
      },
    })
  }

  it.each([
    ["owner", "google_reconnect_required", "reconnect Google, then retry"],
    ["member", "google_reconnect_required", "Google needs reconnecting"],
    ["owner", "INVALID_ARGUMENT", "edit the reply, then publish again"],
    ["owner", "google_timeout", "the reply is fine; retry"],
    ["owner", null, "retry, or edit the reply"],
  ])(
    "says the next step after a failed publish (%s, %s)",
    (role, code, note) => {
      vi.spyOn(sessionHook, "useSessionRole").mockReturnValue(role)
      fakeDetail({ isPending: false, isError: false, data: failedWith(code) })
      const { container } = renderPane(
        <ReviewDetail reviewId="rev-1" actions={<span />} />
      )
      expect(statusStrip(container)).toHaveTextContent(
        `Publish failed · ${note}`
      )
    }
  )

  it("points an editor at the box when there is no reply yet", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ drafts: [], workflowStatus: "new" }),
    })
    const { container } = renderPane(
      <ReviewDetail reviewId="rev-1" actions={<span />} />
    )
    expect(statusStrip(container)).toHaveTextContent(
      "No reply yet · write one above"
    )
  })

  it("says Generating a draft while Generate runs, not Saving", async () => {
    const client = new QueryClient()
    function PendingGenerate() {
      // Generate's input is a tone alone (no body); it never settles here.
      const generate = useMutation<never, Error, { tone: string }>({
        mutationKey: replyMutationKey("rev-1", "draft"),
        mutationFn: () => new Promise(() => {}),
      })
      const { mutate } = generate
      useEffect(() => {
        mutate({ tone: "warm" })
      }, [mutate])
      return null
    }
    fakeDetail({ isPending: false, isError: false, data: readyToPublish })
    const { container } = render(
      <QueryClientProvider client={client}>
        <Toaster>
          <PendingGenerate />
          <ReviewDetail reviewId="rev-1" actions={<span />} />
        </Toaster>
      </QueryClientProvider>
    )
    await waitFor(() =>
      expect(statusStrip(container)).toHaveTextContent("Generating a draft")
    )
    expect(statusStrip(container)).not.toHaveTextContent("Saving")
  })

  it("says an edited parked reply is not saved, and what saving does", () => {
    function Dirty() {
      useRegisterDirtyGuard(true, async () => true, {
        save: async () => null,
        blockedReason: null,
        saving: false,
      })
      return null
    }
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ workflowStatus: "awaiting_approval" }),
    })
    const { container } = renderPane(
      <DirtyGuardProvider>
        <Dirty />
        <ReviewDetail reviewId="rev-1" actions={<span />} />
      </DirtyGuardProvider>
    )
    expect(statusStrip(container)).toHaveTextContent(
      "Your edit isn’t saved · saving takes it out of approval"
    )
  })

  it("says a parked reply is private until it is approved", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({ workflowStatus: "awaiting_approval" }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.getByRole("region", { name: "Your reply" })
    ).toHaveTextContent("Private until it’s approved")
  })

  it("does not say 'you publish' to someone who cannot", () => {
    fakeDetail({
      isPending: false,
      isError: false,
      data: reviewWith({
        capabilities: {
          canPublish: false,
          canEdit: true,
          canRequestApproval: true,
        },
      }),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    const reply = screen.getByRole("region", { name: "Your reply" })
    expect(reply).toHaveTextContent("Private until published")
    expect(reply).not.toHaveTextContent("Private until you publish")
  })

  it("offers no Try again for a review that is gone", () => {
    fakeDetail({
      isPending: false,
      isError: true,
      error: new ApiClientError(404, "review_not_found", "x"),
    })
    renderPane(<ReviewDetail reviewId="rev-1" />)
    expect(
      screen.getByText("This review is no longer available.")
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /Try again/ })
    ).not.toBeInTheDocument()
  })
})
