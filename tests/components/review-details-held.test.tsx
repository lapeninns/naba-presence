import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { UseQueryResult } from "@tanstack/react-query"
import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewDetail } from "@/components/inbox/review-detail"
import { Toaster } from "@/components/ui/toast"
import type { ReviewDetail as ReviewDetailData } from "@/lib/api/reviews"
import * as detailHook from "@/lib/queries/use-review-detail"
import * as sessionHook from "@/lib/queries/use-session"
import { gate } from "./review-details-held-gate"

const { heldImport } = await vi.hoisted(
  () => import("./review-details-held-gate")
)
vi.mock("@/components/inbox/detail/review-metadata-loader", () => ({
  importReviewMetadata: () => heldImport(),
}))

const detail = {
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
    drafts: [],
    reply: null,
    timeline: [],
    capabilities: {
      canPublish: true,
      canEdit: true,
      canRequestApproval: false,
    },
    latestVerification: null,
  },
} as unknown as ReviewDetailData

afterEach(() => {
  vi.restoreAllMocks()
})

// The toast viewport is also a dialog; the details are the one with this name.
const details = () => screen.queryByRole("dialog", { name: "Review details" })

describe("Review details while its code is on the way", () => {
  it("is a modal from the click, closes cleanly, and is replaced by the real dialog", async () => {
    vi.spyOn(sessionHook, "useSession").mockReturnValue({
      data: { session: { userId: "me-1", role: "owner" } },
      isError: false,
    } as unknown as ReturnType<typeof sessionHook.useSession>)
    vi.spyOn(detailHook, "useReviewDetail").mockReturnValue({
      isPending: false,
      isError: false,
      data: detail,
    } as UseQueryResult<ReviewDetailData>)
    const user = userEvent.setup()
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster>
          <ReviewDetail reviewId="rev-1" />
        </Toaster>
      </QueryClientProvider>
    )

    const more = screen.getByRole("button", { name: "More actions" })
    async function chooseDetails() {
      await user.click(more)
      await user.click(
        await screen.findByRole("menuitem", { name: "Review details" })
      )
    }

    // The code has not arrived (the deferred is held), yet the choice is
    // answered at once by a visible, modal dialog.
    await chooseDetails()
    const shell = await screen.findByRole("dialog", { name: "Review details" })
    expect(within(shell).getByRole("status")).toHaveTextContent("Loading…")
    expect(within(shell).queryByText("Review received")).toBeNull()
    await waitFor(() =>
      expect(shell).toContainElement(document.activeElement as HTMLElement)
    )

    // Closing it works and hands focus back to the ⋯ trigger.
    await user.click(within(shell).getByRole("button", { name: /close/i }))
    await waitFor(() => expect(details()).not.toBeInTheDocument())
    expect(more).toHaveFocus()

    // Asked for again while the code is still held: the shell again.
    await chooseDetails()
    expect(
      within(
        await screen.findByRole("dialog", { name: "Review details" })
      ).getByRole("status")
    ).toHaveTextContent("Loading…")

    // The code arriving replaces the shell with the real dialog, still open.
    await act(async () => {
      gate.release()
      await new Promise((resolve) => setTimeout(resolve, 50))
    })
    await waitFor(() => {
      const real = details()
      expect(real).not.toBeNull()
      expect(
        within(real as HTMLElement).getByText("Review received")
      ).toBeTruthy()
    })
    expect(screen.queryByText("Loading…")).toBeNull()
  })
})
