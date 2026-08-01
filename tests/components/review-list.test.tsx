import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewList } from "@/components/inbox/review-list"
import type { ReviewRow } from "@/lib/api/reviews"

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "rev-1",
    location: { id: "loc-1", name: "Riverside" },
    reviewer: { displayName: "Sam Traveller", isAnonymous: false },
    rating: 4,
    text: "Great stay, would return.",
    detectedLanguageCode: "en",
    languageConfidence: 0.9,
    createTime: "2026-07-30T10:00:00.000Z",
    updateTime: "2026-07-30T10:00:00.000Z",
    hasMedia: false,
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
    replyStatus: null,
    googleReplyState: null,
    googlePolicyViolation: null,
    replyBody: null,
    syncStatus: "succeeded",
    capabilities: { canPublish: true, canEdit: true },
    ...overrides,
  }
}

afterEach(() => vi.restoreAllMocks())

describe("ReviewList", () => {
  it("renders a labelled region with one selectable button per review", () => {
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First review", reviewer: { displayName: "Ann", isAnonymous: false } }),
          row({ id: "b", text: "Second review", reviewer: { displayName: "Ben", isAnonymous: false } }),
        ]}
        selectedId={undefined}
        onSelect={() => {}}
      />
    )
    expect(screen.getByRole("region", { name: "Review list" })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /First review/ })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /Second review/ })).toBeInTheDocument()
  })

  it("marks the selected row with aria-current and makes it the only tab stop", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="b"
        onSelect={() => {}}
      />
    )
    const second = screen.getByRole("button", { name: /Second/ })
    expect(second).toHaveAttribute("aria-current", "true")
    expect(second).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("button", { name: /First/ })).toHaveAttribute("tabindex", "-1")
  })

  it("moves selection with ArrowDown/ArrowUp (roving tabindex)", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn()
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="a"
        onSelect={onSelect}
      />
    )
    screen.getByRole("button", { name: /First/ }).focus()
    await user.keyboard("{ArrowDown}")
    expect(onSelect).toHaveBeenCalledWith("b")
  })

  it("shows the year only when a review is not from the current year", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "Old", updateTime: "2024-03-04T10:00:00.000Z" })]}
        selectedId={undefined}
        onSelect={() => {}}
        timezone="Europe/London"
      />
    )
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })
})
