import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ReviewList } from "@/components/inbox/review-list"
import type { ReviewRow } from "@/lib/api/reviews"
import { deriveReplyStatus, replyStateFromRow } from "@/lib/inbox/reply-state"

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
    workflowStatus: "new",
    draftId: null,
    draftBody: null,
    verificationStatus: null,
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("ReviewList", () => {
  it("renders a labelled region with one selectable button per review", () => {
    render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            text: "First review",
            reviewer: {
              displayName: "Ann",
              isAnonymous: false,
              profilePhotoUrl: null,
            },
          }),
          row({
            id: "b",
            text: "Second review",
            reviewer: {
              displayName: "Ben",
              isAnonymous: false,
              profilePhotoUrl: null,
            },
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    expect(
      screen.getByRole("region", { name: "Review list" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /First review/ })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /Second review/ })
    ).toBeInTheDocument()
  })

  // The row is the whole of the queue: there is no avatar and no workflow
  // badge left to carry any of it, so every fact an operator triages on has to
  // survive here. Asserted as content rather than as layout, because the four
  // lines may be rearranged but none of them may go missing.
  it("says who wrote it, where, how many stars, what they said and when", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a", hasMedia: true })]}
        selectedId={undefined}
        onSelect={() => true}
        timezone="Europe/London"
      />
    )

    const button = screen.getByRole("button", { name: /Sam Traveller/ })
    expect(button).toHaveTextContent("Sam Traveller")
    // Client first: "Riverside" alone does not say whose voice to reply in.
    expect(button).toHaveTextContent("Old Crown Group · Riverside")
    expect(button).toHaveTextContent("Great stay, would return.")
    expect(screen.getByRole("img", { name: "4 stars" })).toBeInTheDocument()
    expect(screen.getByRole("img", { name: "Has photos" })).toBeInTheDocument()

    // The age is a real <time>, so the machine-readable instant and the exact
    // timestamp are both available however the visible form is abbreviated.
    const time = button.querySelector("time")
    expect(time).toHaveAttribute("dateTime", "2026-07-30T10:00:00.000Z")
    expect(time).toHaveAttribute("title", expect.stringContaining("30 Jul"))
    expect(time?.textContent).not.toBe("")
  })

  // The e2e suite finds a row by the words in it ("the review from Sam about
  // the stay"), so the accessible name has to keep carrying both the reviewer
  // and the review text. Nesting the text inside the <button> is what does
  // that; a visually-hidden label on the button would silently break it.
  it("puts the reviewer and the review text in the row's accessible name", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    const name =
      screen.getByRole("button", { name: /Sam Traveller/ }).textContent ?? ""
    expect(name).toContain("Sam Traveller")
    expect(name).toContain("Great stay, would return.")
  })

  it("marks the selected row with aria-current and makes it the only tab stop", () => {
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
        selectedId="b"
        onSelect={() => true}
      />
    )
    const second = screen.getByRole("button", { name: /Second/ })
    expect(second).toHaveAttribute("aria-current", "true")
    expect(second).toHaveAttribute("tabindex", "0")
    expect(screen.getByRole("button", { name: /First/ })).toHaveAttribute(
      "tabindex",
      "-1"
    )
  })

  // The selected row is now a neutral fill rather than the accent tint, which
  // makes the fill alone a weak cue — and no cue at all in greyscale, in
  // forced colours, or to a screen reader. The stated requirement is that the
  // current row stays identifiable without it, so the sr-only text and the
  // chevron ride with the selection and appear on exactly one row.
  it("gives the selected row a cue that does not depend on colour", () => {
    const { container, rerender } = render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
        selectedId="b"
        onSelect={() => true}
      />
    )
    const second = screen.getByRole("button", { name: /Second/ })
    expect(second).toHaveTextContent("Selected review")
    expect(screen.getAllByText("Selected review")).toHaveLength(1)
    expect(screen.getByRole("button", { name: /First/ })).not.toHaveTextContent(
      "Selected review"
    )
    expect(second.className).toContain("bg-fill")
    expect(second.className).not.toContain("bg-surface-alt")

    // And it follows the selection rather than being painted on once.
    rerender(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
        selectedId="a"
        onSelect={() => true}
      />
    )
    expect(screen.getByRole("button", { name: /First/ })).toHaveTextContent(
      "Selected review"
    )
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1)
  })

  it("moves selection with ArrowDown/ArrowUp (roving tabindex)", async () => {
    const user = userEvent.setup()
    const onSelect = vi.fn().mockReturnValue(true)
    render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
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
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
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
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
        ]}
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

  // Below lg, "Back to reviews" clears the selection and closes the detail
  // sheet while this list stays mounted. Focus has to come back to the row the
  // operator was reading, otherwise it is left on the document body and the
  // next Tab starts from the top of the page.
  it("returns focus to the row that was deselected when the selection is cleared", () => {
    const reviews = [
      row({ id: "a", text: "First" }),
      row({ id: "b", text: "Second" }),
    ]
    const { rerender } = render(
      <ReviewList reviews={reviews} selectedId="b" onSelect={() => true} />
    )
    rerender(
      <ReviewList
        reviews={reviews}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    expect(screen.getByRole("button", { name: /Second/ })).toHaveFocus()
  })

  it("shows the year only when a review is not from the current year", () => {
    render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            text: "Old",
            createTime: "2024-03-04T10:00:00.000Z",
            updateTime: "2024-03-04T10:00:00.000Z",
          }),
        ]}
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
            reviewer: {
              displayName: "Rosi Roberto",
              isAnonymous: false,
              profilePhotoUrl: null,
            },
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
    expect(screen.getByRole("img", { name: "Translated" })).toBeInTheDocument()
  })

  // One derivation, two renderings: the row shows the short form and speaks
  // the sentence, so a reader hears the same words the detail pane will show
  // when they open the review. Hard-coding the copy as well as comparing
  // against `deriveReplyStatus` is deliberate — the parity check alone would
  // keep passing if the ladder itself started answering something wrong.
  it("shows the short status but speaks the sentence the detail pane shows", () => {
    const reviews = [
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
    ]
    render(
      <ReviewList
        reviews={reviews}
        selectedId={undefined}
        onSelect={() => true}
      />
    )

    expect(screen.getByLabelText("No draft yet")).toHaveTextContent(
      "Needs reply"
    )
    expect(
      screen.getByLabelText("Draft checked · Ready to publish")
    ).toHaveTextContent("Ready to publish")
    expect(screen.getByLabelText("Reply published")).toHaveTextContent(
      "Replied"
    )

    for (const review of reviews) {
      const expected = deriveReplyStatus(replyStateFromRow(review))
      const status = screen.getByLabelText(expected.text)
      expect(status).toHaveAttribute("data-slot", "reply-status")
      expect(status).toHaveAttribute("data-tone", expected.tone)
      expect(status).toHaveTextContent(expected.short)
    }

    // The old workflow badges are gone; nothing in a row repeats the raw
    // wire status.
    expect(screen.queryByText("Verified")).not.toBeInTheDocument()
  })

  // `awaiting_approval` alone cannot say who is being waited on — the
  // location grant stays true for the person who requested the approval. Only
  // the server-scoped queue knows, so the row must pass it through rather than
  // guessing, and the two scopes have to read differently.
  it("names who an approval is waiting on, from the queue it was fetched under", () => {
    const pending = row({
      id: "a",
      text: "Pending",
      workflowStatus: "awaiting_approval",
      draftBody: "Thanks!",
      verificationStatus: "pass",
    })

    const { rerender } = render(
      <ReviewList
        reviews={[pending]}
        selectedId={undefined}
        queue="awaiting_my_approval"
        onSelect={() => true}
      />
    )
    expect(screen.getByLabelText("Approval required")).toHaveTextContent(
      "For approval"
    )

    rerender(
      <ReviewList
        reviews={[pending]}
        selectedId={undefined}
        queue="awaiting_others"
        onSelect={() => true}
      />
    )
    expect(
      screen.getByLabelText("Waiting for another approver")
    ).toHaveTextContent("Awaiting approval")

    // The aggregate Approval tab is not server-scoped, so the row declines to
    // guess rather than telling the requester to approve their own reply.
    rerender(
      <ReviewList
        reviews={[pending]}
        selectedId={undefined}
        queue="approval"
        onSelect={() => true}
      />
    )
    // …and there "Awaiting approval" is all the tab already says, so the
    // row does not repeat it.
    expect(screen.queryByLabelText("Waiting for approval")).toBeNull()
  })

  it("drops a status pill that only repeats the queue it is listed under", () => {
    const fresh = row({ id: "a", text: "New one" })
    const { container, rerender } = render(
      <ReviewList
        reviews={[fresh]}
        selectedId={undefined}
        queue="needs_reply"
        onSelect={() => true}
      />
    )
    expect(container.querySelector('[data-slot="reply-status"]')).toBeNull()
    rerender(
      <ReviewList
        reviews={[fresh]}
        selectedId={undefined}
        queue="all"
        onSelect={() => true}
      />
    )
    expect(
      container.querySelector('[data-slot="reply-status"]')
    ).toHaveTextContent("Needs reply")
  })

  it("dates a row by when it was written, and notes an edit", () => {
    render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            createTime: "2024-03-04T10:00:00.000Z",
            updateTime: "2024-05-01T10:00:00.000Z",
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
        timezone="Europe/London"
      />
    )
    const time = screen.getByText(/2024/)
    expect(time).toHaveAttribute("datetime", "2024-03-04T10:00:00.000Z")
    expect(time).toHaveTextContent("edited")
  })

  // The tick box is only visible on hover or once ticked, so its name is the
  // only thing that says which review it belongs to — "Select" on its own is
  // useless in a list of forty identical boxes.
  it("names the bulk-selection checkbox after the reviewer", async () => {
    const user = userEvent.setup()
    const toggle = vi.fn()
    render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
        selection={{ selected: new Set(), toggle, extendTo: vi.fn() }}
      />
    )
    const checkbox = screen.getByRole("checkbox", {
      name: "Select the review from Sam Traveller",
    })
    await user.click(checkbox)
    expect(toggle).toHaveBeenCalledWith("a")
  })

  // Shift-click is the range gesture every mail client has; without it,
  // clearing thirty failed rows means thirty clicks.
  it("extends the selection instead of toggling when the tick box is shift-clicked", async () => {
    const user = userEvent.setup()
    const toggle = vi.fn()
    const extendTo = vi.fn()
    render(
      <ReviewList
        reviews={[
          row({
            id: "a",
            reviewer: {
              displayName: "Ann",
              isAnonymous: false,
              profilePhotoUrl: null,
            },
          }),
          row({
            id: "b",
            reviewer: {
              displayName: "Ben",
              isAnonymous: false,
              profilePhotoUrl: null,
            },
          }),
        ]}
        selectedId={undefined}
        onSelect={() => true}
        selection={{ selected: new Set(["a"]), toggle, extendTo }}
      />
    )
    await user.keyboard("{Shift>}")
    await user.click(
      screen.getByRole("checkbox", { name: "Select the review from Ben" })
    )
    await user.keyboard("{/Shift}")
    expect(extendTo).toHaveBeenCalledWith("b")
    expect(toggle).not.toHaveBeenCalled()
  })
})
