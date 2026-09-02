import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewList } from "@/components/inbox/review-list"
import type { ReviewRow } from "@/lib/api/reviews"

function row(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: "rev-1",
    location: { id: "loc-1", name: "Riverside" },
    reviewer: { displayName: "Sam Traveller", isAnonymous: false, profilePhotoUrl: null },
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
    capabilities: { canPublish: true, canEdit: true, canRequestApproval: false },
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ReviewList", () => {
  it("renders a labelled region with one selectable button per review", () => {
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First review", reviewer: { displayName: "Ann", isAnonymous: false, profilePhotoUrl: null } }),
          row({ id: "b", text: "Second review", reviewer: { displayName: "Ben", isAnonymous: false, profilePhotoUrl: null } }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
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
        onSelect={() => true}
      />
    )
    const second = screen.getByRole("button", { name: /Second/ })
    expect(second).toHaveAttribute("aria-current", "true")
    expect(second).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("button", { name: /First/ })).toHaveAttribute("tabindex", "-1")
  })

  it("moves selection with ArrowDown/ArrowUp (roving tabindex)", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockReturnValue(true)
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
    expect(screen.getByRole("button", { name: /Second/ })).toHaveFocus()
  })

  it("jumps to first and last rows with Home and End", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockReturnValue(true)
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
          row({ id: "c", text: "Third" }),
        ]}
        selectedId="b"
        onSelect={onSelect}
      />
    )
    screen.getByRole("button", { name: /Second/ }).focus()
    await user.keyboard("{Home}")
    expect(onSelect).toHaveBeenCalledWith("a")
    await user.keyboard("{End}")
    expect(onSelect).toHaveBeenCalledWith("c")
  })

  // A `false` return means the dirty guard blocked the change (the user
  // cancelled the discard confirm). Focus must NOT move onto the next row --
  // that row's tabIndex is still -1, so landing DOM focus there would desync
  // the roving-tabindex invariant from the visible selection.
  it("does not move focus when onSelect reports the change was blocked", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockReturnValue(false)
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="a"
        onSelect={onSelect}
      />
    )
    const first = screen.getByRole("button", { name: /First/ })
    first.focus()
    await user.keyboard("{ArrowDown}")
    expect(onSelect).toHaveBeenCalledWith("b")
    expect(first).toHaveFocus()
  })

  it("asks the parent to page when the arrow key runs off either end", async () => {
    const user = userEvent.setup()
    const onMovePastEnd = vi.fn()
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "First" }), row({ id: "b", text: "Second" })]}
        selectedId="b"
        onSelect={() => true}
        onMovePastEnd={onMovePastEnd}
      />
    )
    screen.getByRole("button", { name: /Second/ }).focus()
    await user.keyboard("{ArrowDown}")
    expect(onMovePastEnd).toHaveBeenCalledWith("next")
    screen.getByRole("button", { name: /First/ }).focus()
    await user.keyboard("{ArrowUp}")
    expect(onMovePastEnd).toHaveBeenCalledWith("prev")
  })

  it("shows the year only when a review is not from the current year", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", text: "Old", updateTime: "2024-03-04T10:00:00.000Z" })]}
        selectedId={undefined}
        onSelect={() => true}
        timezone="Europe/London"
      />
    )
    expect(screen.getByText(/2024/)).toBeInTheDocument()
  })

  it("previews only the English translation for Google-translated reviews", () => {
    const blob =
      "(Translated by Google) The food is excellent. Truly excellent. (Original) Si mangia benissimo. Veramente eccellente."
    render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            text: blob,
            detectedLanguageCode: "it",
            reviewer: { displayName: "Rosi Roberto", isAnonymous: false, profilePhotoUrl: null },
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    const button = screen.getByRole("button", {
      name: /The food is excellent/,
    })
    expect(button).toHaveTextContent("The food is excellent. Truly excellent.")
    expect(button).not.toHaveTextContent("Si mangia benissimo")
    expect(button).not.toHaveTextContent("(Translated by Google)")
    expect(button).not.toHaveTextContent("(Original)")
    expect(screen.getByText("Translated")).toBeInTheDocument()
  })

  it("shows the reviewer profile photo when Google provided one", () => {
    // Base UI only mounts Avatar.Image after the browser reports the URL
    // loaded; jsdom's Image stub never does, so drive a successful load here.
    class LoadedImage {
      onload: (() => void) | null = null
      onerror: (() => void) | null = null
      naturalWidth = 40
      complete = true
      referrerPolicy = ""
      crossOrigin: string | null = null
      sizes = ""
      srcset = ""
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }
    vi.stubGlobal("Image", LoadedImage)

    const { container } = render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            text: "Nice place",
            reviewer: {
              displayName: "Sam Traveller",
              isAnonymous: false,
              profilePhotoUrl: "https://lh3.googleusercontent.com/a/photo",
            },
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    return waitFor(() => {
      expect(
        container.querySelector('[data-slot="avatar-image"]')
      ).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/photo")
    })
  })

  it("shows compact situation chips instead of workflow badge labels", () => {
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "Fresh", workflowStatus: "new" }),
          row({
            id: "b",
            text: "Ready",
            workflowStatus: "verified",
            draftBody: "Thanks!",
            verificationStatus: "pass",
          }),
          row({
            id: "c",
            text: "Live",
            workflowStatus: "published",
            draftBody: "Thanks!",
            replyBody: "Thanks!",
            replyStatus: "published",
            verificationStatus: "pass",
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    expect(screen.getByLabelText("No reply yet")).toHaveTextContent("New")
    expect(screen.getByLabelText("Ready to publish")).toHaveTextContent("Ready")
    expect(screen.getByLabelText("Published")).toHaveTextContent("Live")
    expect(screen.queryByText("Verified")).not.toBeInTheDocument()
  })
})
