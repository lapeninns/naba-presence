import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { selectionHitAreaClassName } from "@/components/ui/checkbox"
import { Toaster } from "@/components/ui/toast"
import { ReviewList, ReviewRowsSkeleton } from "@/components/inbox/review-list"
import type { ReviewRow } from "@/lib/api/reviews"
import { deriveReplyStatus, replyStateFromRow } from "@/lib/inbox/reply-state"
import * as bulkHook from "@/lib/queries/use-bulk-review-action"

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

    const button = screen.getByRole("button", { name: /^Sam Traveller/ })
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
      screen.getByRole("button", { name: /^Sam Traveller/ }).textContent ?? ""
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
    // The visible date carries the year; the spoken one is the exact time.
    const time = document.querySelector("time")!
    expect(time.querySelector("[aria-hidden]")).toHaveTextContent(/2024/)
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

    expect(screen.getByLabelText("No reply yet")).toHaveTextContent(
      "Needs reply"
    )
    expect(
      screen.getByLabelText("Draft checked · Ready to publish")
    ).toHaveTextContent("Ready to publish")
    expect(screen.getByLabelText("Live on Google")).toHaveTextContent("Replied")

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
    const time = document.querySelector("time")!
    expect(time).toHaveAttribute("datetime", "2024-03-04T10:00:00.000Z")
    expect(time.querySelector("[aria-hidden]")).toHaveTextContent(
      /2024 · edited/
    )
    // Spoken in full rather than left to a hover title a touch screen never
    // shows.
    expect(time.querySelector(".sr-only")).toHaveTextContent(
      /^Written .*2024.*, edited .*2024/
    )
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
        selection={{
          selected: new Set(),
          toggle,
          extendTo: vi.fn(),
          selectMode: false,
        }}
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
        selection={{
          selected: new Set(["a"]),
          toggle,
          extendTo,
          selectMode: false,
        }}
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
  // Select mode (components/inbox/selection-context.tsx). A desk always shows
  // the tick boxes; touch shows them only while the operator has asked to
  // batch, so a phone row keeps its width the rest of the time.
  describe("select mode", () => {
    function stubPointer(coarse: boolean, wide: boolean) {
      vi.stubGlobal(
        "matchMedia",
        vi.fn((query: string) => ({
          matches: query.includes("pointer: coarse")
            ? coarse
            : query.includes("min-width")
              ? wide
              : false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          onchange: null,
          dispatchEvent: vi.fn(),
        }))
      )
    }

    function renderSelectable(selectMode: boolean) {
      const toggle = vi.fn()
      const onSelect = vi.fn(() => true)
      render(
        <ReviewList
          reviews={[row({ id: "a" })]}
          selectedId={undefined}
          onSelect={onSelect}
          selection={{
            selected: new Set(),
            toggle,
            extendTo: vi.fn(),
            selectMode,
          }}
        />
      )
      const column = screen
        .queryByRole("checkbox", {
          name: "Select the review from Sam Traveller",
        })
        ?.closest('[data-slot="review-row-select"]')
      return { toggle, onSelect, column }
    }

    it("hides the tick-box column on touch until select mode is on", () => {
      const { column } = renderSelectable(false)
      expect(column).toHaveClass("hidden", "desk:flex")
    })

    it("shows the tick-box column at every size in select mode", () => {
      const { column } = renderSelectable(true)
      expect(column).toHaveClass("flex")
      expect(column).not.toHaveClass("hidden")
    })

    it("ticks a row instead of opening it when tapped on touch in select mode", async () => {
      stubPointer(true, false)
      const user = userEvent.setup()
      const { toggle, onSelect } = renderSelectable(true)
      await user.click(screen.getByRole("button", { name: /^Sam Traveller/ }))
      expect(toggle).toHaveBeenCalledWith("a")
      expect(onSelect).not.toHaveBeenCalled()
    })

    // RC3 QA #1: on a phone a tap on the tick box landed on the row's
    // control wrapper, whose 44px `after:` overhang was drawn over the box.
    it("ticks the row once from a touch on its tick box, without opening it", async () => {
      stubPointer(true, false)
      const user = userEvent.setup()
      const { toggle, onSelect } = renderSelectable(true)
      const box = screen.getByRole("checkbox", {
        name: "Select the review from Sam Traveller",
      })
      await user.pointer({ keys: "[TouchA]", target: box })
      expect(toggle).toHaveBeenCalledTimes(1)
      expect(toggle).toHaveBeenCalledWith("a")
      expect(onSelect).not.toHaveBeenCalled()
      // The box stacks above the wrapper's overhang (the wrapper is a
      // positioned z-raised layer, so `z-raised` here is within it), and
      // keeps its own 44px touch halo, so it is the topmost target.
      const wrapper = box.closest('[data-slot="list-row-control"]')!
      expect(wrapper).toHaveClass("z-raised")
      expect(box).toHaveClass("relative", "z-raised")
      expect(box).toHaveClass(...selectionHitAreaClassName.split(" "))
    })

    it("ticks the row from a touch on the overhang beside the box", async () => {
      stubPointer(true, false)
      const user = userEvent.setup()
      const { toggle, onSelect } = renderSelectable(true)
      const wrapper = document.querySelector<HTMLElement>(
        '[data-slot="list-row-control"]'
      )!
      await user.pointer({ keys: "[TouchA]", target: wrapper })
      expect(toggle).toHaveBeenCalledTimes(1)
      expect(toggle).toHaveBeenCalledWith("a")
      expect(onSelect).not.toHaveBeenCalled()
    })

    it("still opens the row with a mouse on a wide screen", async () => {
      stubPointer(false, true)
      const user = userEvent.setup()
      const { toggle, onSelect } = renderSelectable(true)
      await user.click(screen.getByRole("button", { name: /^Sam Traveller/ }))
      expect(onSelect).toHaveBeenCalledWith("a")
      expect(toggle).not.toHaveBeenCalled()
    })

    it("opens the row on touch when select mode is off", async () => {
      stubPointer(true, false)
      const user = userEvent.setup()
      const { toggle, onSelect, column } = renderSelectable(false)
      // The tick box takes the avatar's place, so on touch outside select
      // mode it is not mounted at all: nothing sits over the avatar where a
      // tap should open the row.
      expect(column).toBeUndefined()
      expect(
        document.querySelector('[data-slot="list-row-control"]')
      ).toBeNull()
      expect(document.querySelector("[data-reviewer-avatar]")).not.toBeNull()
      await user.click(screen.getByRole("button", { name: /^Sam Traveller/ }))
      expect(onSelect).toHaveBeenCalledWith("a")
      expect(toggle).not.toHaveBeenCalled()
    })
  })
})

// INB-08: one review is triaged from its row, not through Select mode. A left
// swipe on touch reveals "No reply needed", and the visible ⋯ button reaches
// the same action for a mouse, a keyboard or a finger that does not swipe.
describe("ReviewList — triage from the row", () => {
  const mutateAsync = vi.fn<(input: unknown) => Promise<unknown>>(
    async (input) => {
      const { reviewIds, marks } = input as {
        reviewIds?: string[]
        marks?: { reviewId: string }[]
      }
      return {
        results: (reviewIds ?? marks?.map((mark) => mark.reviewId) ?? []).map(
          (reviewId) => ({
            reviewId,
            status: "ok",
            triagedAt: "2026-10-16T07:00:00.000001Z",
          })
        ),
      }
    }
  )

  beforeEach(() => {
    mutateAsync.mockClear()
    vi.spyOn(bulkHook, "useBulkReviewAction").mockReturnValue({
      mutateAsync,
      isPending: false,
    } as unknown as ReturnType<typeof bulkHook.useBulkReviewAction>)
  })

  function renderRows(selectMode = false, withSelection = true) {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Toaster>
          <ReviewList
            reviews={[row({ id: "a" }), row({ id: "b" })]}
            selectedId={undefined}
            onSelect={() => true}
            selection={
              withSelection
                ? {
                    selected: new Set(),
                    toggle: vi.fn(),
                    extendTo: vi.fn(),
                    selectMode,
                  }
                : undefined
            }
          />
        </Toaster>
      </QueryClientProvider>
    )
  }

  it("marks a review as needing no reply from the row's ⋯ at once, with Undo", async () => {
    const user = userEvent.setup()
    renderRows()
    const buttons = screen.getAllByRole("button", {
      name: /^Actions for /,
    })
    expect(buttons).toHaveLength(2)

    await user.click(buttons[1])
    await user.click(
      await screen.findByRole("menuitem", { name: "No reply needed" })
    )
    // Nothing to confirm: it is done, and Undo is the way back.
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    expect(mutateAsync).toHaveBeenCalledWith({
      action: "mark_reviewed",
      reviewIds: ["b"],
    })
    await user.click(await screen.findByRole("button", { name: "Undo" }))
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync).toHaveBeenLastCalledWith({
      action: "mark_unreviewed",
      marks: [{ reviewId: "b", triagedAt: "2026-10-16T07:00:00.000001Z" }],
    })
    expect(
      await screen.findByText("Review back in Needs reply")
    ).toBeInTheDocument()
  })

  it("sends a second row pressed while the first is still sending", async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    mutateAsync.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({ results: [{ reviewId: "a", status: "ok" }] })
        })
    )
    renderRows()
    const [first, second] = screen.getAllByRole("button", {
      name: /^Actions for /,
    })
    await user.click(first)
    await user.click(
      await screen.findByRole("menuitem", { name: "No reply needed" })
    )
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1))
    // The first is still in flight when the second row is acted on.
    await user.click(second)
    await user.click(
      await screen.findByRole("menuitem", { name: "No reply needed" })
    )
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(2))
    expect(mutateAsync).toHaveBeenLastCalledWith({
      action: "mark_reviewed",
      reviewIds: ["b"],
    })
    release()
  })

  it("names each row's ⋯ after its reviewer", () => {
    renderRows()
    const [first] = screen.getAllByRole("button", { name: /^Actions for / })
    expect(first).toHaveAccessibleName(/^Actions for \S/)
    expect(first).not.toHaveAccessibleName("Actions for this review")
  })

  it("reaches the same action by a left swipe, with no question first", async () => {
    const user = userEvent.setup()
    renderRows()
    const slide = document.querySelector<HTMLElement>(
      '[data-slot="list-row-swipe-slide"]'
    )!
    const init = { pointerType: "touch", pointerId: 1, isPrimary: true }
    fireEvent.pointerDown(slide, { ...init, clientX: 300, clientY: 100 })
    for (const step of [1, 2, 3]) {
      fireEvent.pointerMove(slide, {
        ...init,
        clientX: 300 - 30 * step,
        clientY: 100,
      })
    }
    fireEvent.pointerUp(slide, { ...init, clientX: 210, clientY: 100 })

    const open = document.querySelector(
      '[data-slot="list-row-swipe"][data-open]'
    )!
    expect(open).not.toBeNull()
    // The swipe alone neither opened the review nor sent anything.
    expect(mutateAsync).not.toHaveBeenCalled()
    await user.click(
      open.querySelector<HTMLElement>('[data-slot="list-row-swipe-action"]')!
    )
    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        action: "mark_reviewed",
        reviewIds: ["a"],
      })
    )
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
  })

  // The same gate as the tick boxes, which a viewer is not given.
  it("offers a viewer no row actions", () => {
    renderRows(false, false)
    expect(
      screen.queryByRole("button", { name: /^Actions for / })
    ).not.toBeInTheDocument()
    expect(
      document.querySelector('[data-slot="list-row-swipe"]')
    ).not.toBeInTheDocument()
  })

  it("leaves the rows to tapping while select mode is ticking them", () => {
    renderRows(true)
    expect(
      screen.queryByRole("button", { name: /^Actions for / })
    ).not.toBeInTheDocument()
  })
})

// Notion Mail's row (REFERENCE-BRIEF §2.1): three lines, avatar-led, with a
// needs-reply "unread" emphasis that only reinforces the status words.
describe("ReviewList row anatomy", () => {
  const replied = () =>
    row({
      id: "b",
      text: "Handled one",
      reviewer: {
        displayName: "Ben Handled",
        isAnonymous: false,
        profilePhotoUrl: null,
      },
      workflowStatus: "published",
      draftBody: "Thanks!",
      replyBody: "Thanks!",
      replyStatus: "published",
      verificationStatus: "pass",
    })

  function nameOf(button: HTMLElement, name: string) {
    return [...button.querySelectorAll("span")].find(
      (node) => node.textContent === name && node.children.length === 0
    )!
  }

  it("emphasises a review that needs a reply with weight, full ink and a dot", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a" }), replied()]}
        selectedId={undefined}
        queue="all"
        onSelect={() => true}
      />
    )
    const fresh = screen.getByRole("button", { name: /^Sam Traveller/ })
    const handled = screen.getByRole("button", { name: /^Ben Handled/ })

    expect(nameOf(fresh, "Sam Traveller")).toHaveClass(
      "font-semibold",
      "text-ink"
    )
    // The ListRow primitive's unread emphasis draws the dot.
    expect(fresh).toHaveAttribute("data-emphasis", "unread")
    expect(
      fresh.querySelector('[data-slot="list-row-unread-dot"]')
    ).toHaveAttribute("aria-hidden", "true")
    // The words take the primitive's snippet ink on every row (NM: the
    // name and the dot carry "unread", not the snippet).
    expect(
      fresh
        .querySelector('[data-slot="review-row-preview"]')!
        .closest('[data-slot="list-row-preview"]')
    ).toHaveClass("text-ink-secondary")

    expect(nameOf(handled, "Ben Handled")).toHaveClass(
      "font-normal",
      "text-ink-secondary"
    )
    expect(handled).toHaveAttribute("data-emphasis", "read")
    expect(
      handled.querySelector('[data-slot="list-row-unread-dot"]')
    ).toBeNull()
    expect(
      handled
        .querySelector('[data-slot="review-row-preview"]')!
        .closest('[data-slot="list-row-preview"]')
    ).toHaveClass("text-ink-secondary")
    // The status word stays: the dot and weight only reinforce it.
    expect(screen.getByLabelText("No reply yet")).toHaveTextContent(
      "Needs reply"
    )
    expect(screen.getByLabelText("Live on Google")).toHaveTextContent("Replied")
  })

  it("speaks 'Needs reply' once: in words where the pill is dropped, never twice", () => {
    const { rerender } = render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        queue="needs_reply"
        onSelect={() => true}
      />
    )
    const button = screen.getByRole("button", { name: /^Sam Traveller/ })
    // In the Needs reply queue the pill would repeat the tab, so it is
    // dropped, and the dot is not words: a sr-only word carries it.
    expect(button.querySelector('[data-slot="reply-status"]')).toBeNull()
    const spoken = screen.getAllByText(/Needs reply/)
    expect(spoken).toHaveLength(1)
    expect(spoken[0]).toHaveClass("sr-only")
    expect(spoken[0]).toHaveTextContent(/^, Needs reply$/)

    rerender(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        queue="all"
        onSelect={() => true}
      />
    )
    // Where the pill shows, the words are seen once (the pill) and spoken
    // once: the row's unread word after the name says the pill's sentence,
    // and the pill is not spoken again.
    const again = screen.getAllByText(/Needs reply/)
    expect(again).toHaveLength(1)
    expect(again[0]).toHaveAttribute("data-slot", "reply-status")
    expect(again[0]).toHaveAttribute("aria-hidden", "true")
    const said = screen.getAllByText(/No reply yet/)
    expect(said).toHaveLength(1)
    expect(said[0]).toHaveClass("sr-only")
    expect(said[0]).toHaveTextContent(/^, No reply yet$/)
    expect(
      screen.getByRole("button", { name: /^Sam Traveller, No reply yet/ })
    ).toBeInTheDocument()
  })

  it("puts the status pill on the venue line, trailing, and the words last", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        queue="all"
        onSelect={() => true}
      />
    )
    const button = screen.getByRole("button", { name: /^Sam Traveller/ })
    const venue = button.querySelector('[data-slot="review-row-venue"]')!
    const pill = button.querySelector('[data-slot="reply-status"]')!
    // The venue is the row's subtitle and the pill rides its line, last and
    // never squeezed (R3 F2-S2, RC3 QA #2): under sm (24rem, any phone up
    // to ~470px) the pill drops below so the client · location keeps its
    // width; the location takes the rest with a zero basis, so it never
    // forces that wrap itself. It is one line (DSK-12): the client gives way
    // first, with the whole text as the title.
    const subtitle = venue.closest('[data-slot="list-row-subtitle"]')!
    expect(subtitle).not.toBeNull()
    expect(venue).toHaveClass("@container/venue")
    const status = pill.closest('[data-slot="review-row-status"]')!
    expect(venue.contains(status)).toBe(true)
    expect(status).toHaveClass(
      "ml-auto",
      "shrink-0",
      "self-center",
      "@max-sm/venue:basis-full"
    )
    expect(pill).toHaveClass("bg-transparent", "border-0")
    expect(status.parentElement).toHaveClass("flex-wrap")
    const location = button.querySelector('[data-slot="review-row-location"]')!
    expect(
      location.compareDocumentPosition(status) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(location).toHaveClass("flex-1", "basis-0", "whitespace-nowrap")
    expect(location).toHaveAttribute("title", "Old Crown Group · Riverside")
    expect(location.className).not.toMatch(/wrap-break-word|line-clamp/)
    expect(venue).not.toHaveClass("whitespace-normal")
    // The client truncates first; the listing, which tells two venues of one
    // client apart, keeps its width.
    const client = location.querySelector('[data-slot="review-row-client"]')!
    expect(client).toHaveClass("truncate", "min-w-0")
    expect(client).toHaveTextContent("Old Crown Group")
    expect(client.nextElementSibling).toHaveTextContent("·")
    // Shrink is proportional, so the listing does not shrink at all (it is
    // capped instead) and the client alone gives way.
    expect(location.lastElementChild).toHaveAttribute(
      "data-slot",
      "review-row-listing"
    )
    expect(location.lastElementChild).toHaveClass(
      "truncate",
      "shrink-0",
      "max-w-2/3"
    )
    expect(client.className).not.toMatch(/shrink-\[/)
    expect(location.lastElementChild).toHaveTextContent("Riverside")
    expect(button.querySelector('[data-slot="list-row-trailing"]')).toBeNull()

    // DOM order is the visual order: name and time, venue, then the words.
    const time = button.querySelector("time")!
    const preview = button.querySelector('[data-slot="review-row-preview"]')!
    expect(
      time.compareDocumentPosition(venue) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(
      venue.compareDocumentPosition(preview) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(preview.closest('[data-slot="list-row-preview"]')).toHaveClass(
      "line-clamp-2",
      "desk:line-clamp-1"
    )
    // The age is the row's meta: sans caption figures, not mono.
    const meta = time.closest('[data-slot="list-row-meta"]')!
    expect(meta).toHaveClass("text-caption", "tabular-nums", "text-ink-muted")
    expect(meta).not.toHaveClass("font-mono")
    expect(time).not.toHaveClass("font-mono")
  })

  it("draws a neutral avatar, never a name-hashed tint", () => {
    render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    const button = screen.getByRole("button", { name: /^Sam Traveller/ })
    const avatar = button.querySelector("[data-reviewer-avatar]")!
    expect(avatar).not.toHaveAttribute("data-avatar-tone")
    // The ListRow leading column's size (`--np-avatar-list`).
    expect(avatar).toHaveAttribute("data-size", "list")
    // The primitive's neutral pair (Drop 1 names it --np-avatar-bg/-ink),
    // and none of the status tints the name hash used to pick.
    expect(avatar).toHaveClass("bg-avatar-bg", "text-avatar-ink")
    expect(avatar.className).not.toMatch(
      /(info|success|warning|danger)-(tint|ink)/
    )
  })

  it("draws the inset hairline under every row but the selected one and the last", () => {
    const { container } = render(
      <ReviewList
        reviews={[
          row({ id: "a", text: "First" }),
          row({ id: "b", text: "Second" }),
          row({ id: "c", text: "Third" }),
        ]}
        selectedId="b"
        onSelect={() => true}
      />
    )
    // The ListRow primitive draws it: each row's <li> carries the hairline,
    // hidden under the last and under the selected one.
    const items = [...container.querySelectorAll('[data-slot="list-row"]')]
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.tagName).toBe("LI")
      expect(item).toHaveClass(
        "after:bg-line-subtle",
        "last:after:hidden",
        "data-selected:after:hidden"
      )
      // From the text column, past the gutter, avatar and gap — a token,
      // not a literal.
      expect(item).toHaveClass("after:start-(--np-row-inset-start)")
    }
    expect(items[0]).not.toHaveAttribute("data-selected")
    expect(items[1]).toHaveAttribute("data-selected", "true")
    expect(items[2]).not.toHaveAttribute("data-selected")
  })

  it("keeps the row at the gutter and puts the tick box in the avatar's column", () => {
    const selection = (selectMode: boolean) => ({
      selected: new Set<string>(),
      toggle: vi.fn(),
      extendTo: vi.fn(),
      selectMode,
    })
    const { rerender } = render(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    const button = () => screen.getByRole("button", { name: /^Sam Traveller/ })
    const avatar = () =>
      button().querySelector<HTMLElement>("[data-reviewer-avatar]")
    const select = () =>
      document.querySelector<HTMLElement>('[data-slot="review-row-select"]')
    // The primitive's padding, whatever the selection tools.
    expect(button()).toHaveClass("px-(--np-page-pad-x)")
    expect(avatar()).not.toHaveClass("desk:hidden")
    expect(select()).toBeNull()

    rerender(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
        selection={selection(false)}
      />
    )
    // A desk shows the tick box over the avatar's column (outside the
    // row's button); the avatar steps aside there, and touch keeps it.
    expect(button()).toHaveClass("px-(--np-page-pad-x)")
    expect(button()).not.toContainElement(select())
    expect(select()!.closest('[data-slot="list-row-control"]')).not.toBeNull()
    expect(select()).toHaveClass("hidden", "desk:flex")
    expect(avatar()).not.toHaveClass("desk:hidden")
    expect(avatar()).toHaveClass("desk:group-hover/review-row:invisible")
    expect(select()).toHaveClass(
      "desk:opacity-0",
      "desk:group-focus-within/review-row:opacity-100"
    )

    rerender(
      <ReviewList
        reviews={[row({ id: "a" })]}
        selectedId={undefined}
        onSelect={() => true}
        selection={selection(true)}
      />
    )
    // Select mode: the tick box at every size, in place of the avatar.
    expect(button()).toHaveClass("px-(--np-page-pad-x)")
    expect(select()).toHaveClass("flex")
    expect(select()).not.toHaveClass("hidden")
    expect(avatar()).toBeNull()
  })
})

// The loading outline is drawn by the same row primitive, so its padding,
// leading column and hairline are the real rows' and nothing moves on swap.
describe("ReviewRowsSkeleton", () => {
  it("draws decorative ListRows at the rows' own geometry", () => {
    const { container } = render(
      <ReviewRowsSkeleton rows={3} aria-busy="true" />
    )
    const outline = container.querySelector(
      '[data-slot="review-rows-skeleton"]'
    )!
    expect(outline).toHaveAttribute("aria-busy", "true")
    const rows = outline.querySelectorAll('[data-slot="list-row"]')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(row).toHaveClass("after:start-(--np-row-inset-start)")
      const hit = row.querySelector('[data-slot="list-row-hit"]')!
      expect(hit.tagName).toBe("DIV")
      expect(hit).toHaveAttribute("aria-hidden", "true")
      expect(hit).toHaveClass("px-(--np-page-pad-x)", "py-3")
      expect(
        row.querySelector(
          '[data-slot="list-row-leading"] [data-slot="skeleton"]'
        )
      ).toHaveClass("size-(--np-avatar-list)")
      expect(
        row.querySelector('[data-slot="list-row-trailing"]')
      ).not.toBeNull()
      expect(row.querySelector('[data-slot="list-row-preview"]')).not.toBeNull()
    }
    expect(container.querySelector("button")).toBeNull()
  })
})

// W2-01: the selected row was scrolled into view on every render with the
// same selection — every 15 s clock tick, settling poll, focus refetch and
// next page — pulling an operator who had scrolled away straight back.
describe("ReviewList — keeping the selection in view", () => {
  const scrollBy = vi.fn()
  beforeEach(() => {
    scrollBy.mockClear()
    // A scroller 100px tall over taller content, with every row drawn below
    // its fold: scrolling the selected row in is always a move.
    Object.defineProperty(HTMLElement.prototype, "scrollBy", {
      configurable: true,
      value: scrollBy,
    })
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000)
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100)
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const top = this.dataset.slot === "review-row" ? 500 : 0
        const height = this.dataset.slot === "review-row" ? 50 : 100
        return DOMRect.fromRect({ x: 0, y: top, width: 300, height })
      }
    )
  })
  afterEach(() => {
    delete (HTMLElement.prototype as { scrollBy?: unknown }).scrollBy
  })

  function list(reviews: ReviewRow[], selectedId: string | undefined) {
    return (
      <div style={{ overflowY: "auto" }}>
        <ReviewList
          reviews={reviews}
          selectedId={selectedId}
          onSelect={() => true}
        />
      </div>
    )
  }
  const page = (prefix: string) =>
    [1, 2, 3].map((n) => row({ id: `${prefix}${n}` }))

  it("scrolls once per selection, not on every render or page", () => {
    const first = page("a")
    const view = render(list(first, "a2"))
    expect(scrollBy).toHaveBeenCalledTimes(1)

    // The same rows, a new array: what every parent render passed.
    view.rerender(list([...first], "a2"))
    // The next page arrives under the selection.
    view.rerender(list([...first, ...page("b")], "a2"))
    expect(scrollBy).toHaveBeenCalledTimes(1)

    view.rerender(list([...first, ...page("b")], "b3"))
    expect(scrollBy).toHaveBeenCalledTimes(2)
  })

  it("brings a selected row in once it arrives in a later page", () => {
    const first = page("a")
    const view = render(list(first, "b1"))
    expect(scrollBy).not.toHaveBeenCalled()
    view.rerender(list([...first, ...page("b")], "b1"))
    expect(scrollBy).toHaveBeenCalledTimes(1)
  })
})

describe("ReviewList refresh bar", () => {
  const rows = [row({ id: "a" })]

  it("is an indeterminate, named Progress while the list refetches", () => {
    render(
      <ReviewList
        reviews={rows}
        selectedId={undefined}
        onSelect={() => true}
        isRefreshing
      />
    )
    const bar = screen.getByRole("progressbar", { name: "Refreshing reviews" })
    expect(bar).toHaveAttribute("data-slot", "progress")
    expect(bar).toHaveAttribute("data-indeterminate", "true")
    expect(bar).not.toHaveAttribute("aria-valuenow")
    // Its highlight stops under reduced motion (the one-off pulse did not),
    // and the section is marked busy as before.
    expect(bar.querySelector(".animate-shimmer")).toHaveClass(
      "motion-reduce:animate-none"
    )
    expect(document.querySelector(".animate-pulse")).toBeNull()
    expect(screen.getByRole("region", { name: "Review list" })).toHaveAttribute(
      "aria-busy",
      "true"
    )
  })

  it("is not drawn when the list is current", () => {
    render(
      <ReviewList reviews={rows} selectedId={undefined} onSelect={() => true} />
    )
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument()
  })
})

describe("ReviewList venue line", () => {
  it("keeps a long venue to one line, truncating the client before the listing", () => {
    render(
      <ReviewList
        reviews={[
          row({
            id: "long",
            location: {
              id: "loc-2",
              name: "Stub location e23631ff",
              clientId: "c1",
              clientName: "Journey Hospitality",
            },
          } as Partial<ReviewRow>),
        ]}
        selectedId={undefined}
        onSelect={() => true}
      />
    )
    const location = document.querySelector(
      '[data-slot="review-row-location"]'
    )!
    expect(location).toHaveAttribute(
      "title",
      "Journey Hospitality · Stub location e23631ff"
    )
    expect(location).toHaveClass("whitespace-nowrap")
    expect(location.className).not.toMatch(/wrap-break-word/)
    expect(location).toHaveTextContent(
      "Journey Hospitality · Stub location e23631ff"
    )
  })
})
