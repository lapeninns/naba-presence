import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it } from "vitest"

import { ReviewedWriteSheet, useOpenerFocus } from "@/components/reviewed-write"
import {
  ReviewedChangeSheet,
  type ReviewedChangeWorkflow,
} from "@/components/locations/profile/sections/reviewed-change-sheet"
import type { GbpChangeSet } from "@/lib/contracts/gbp-change-set"

// A sheet opened from state after an async step, the way the lodging,
// service and place-action reviews open once their preview arrives: the
// opener has re-rendered and no trigger is wired to the dialog.
function StateOpened({ withFinalFocus }: { readonly withFinalFocus: boolean }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <button
        key={busy ? "busy" : "idle"}
        id="lodging-opener"
        type="button"
        onClick={() => {
          setBusy(true)
          setTimeout(() => {
            setBusy(false)
            setOpen(true)
          }, 0)
        }}
      >
        Review lodging changes
      </button>
      <ReviewedWriteSheet
        open={open}
        onOpenChange={setOpen}
        title="Review changes"
        footer={<button type="button">Keep editing</button>}
        finalFocus={
          withFinalFocus
            ? () => document.getElementById("lodging-opener")
            : undefined
        }
      >
        <p>Body</p>
      </ReviewedWriteSheet>
    </>
  )
}

// The opener stays mounted; the sheet opens once a preview arrives, or is
// already open on load (a restored review) with no opener at all.
function HookOpened({
  initiallyOpen = false,
  wired = true,
}: {
  readonly initiallyOpen?: boolean
  readonly wired?: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const finalFocus = useOpenerFocus(open, () =>
    document.getElementById("lodging-heading")
  )
  return (
    <>
      <h2 id="lodging-heading" tabIndex={-1}>
        Lodging
      </h2>
      <button type="button" onClick={() => setTimeout(() => setOpen(true), 0)}>
        Review lodging changes
      </button>
      <ReviewedWriteSheet
        open={open}
        onOpenChange={setOpen}
        title="Review changes"
        footer={
          <button type="button" onClick={() => setOpen(false)}>
            Keep editing
          </button>
        }
        finalFocus={wired ? finalFocus : undefined}
      >
        <p>Body</p>
      </ReviewedWriteSheet>
    </>
  )
}

async function closeWith(key: "{Escape}" | "Keep editing") {
  expect(await screen.findByRole("dialog")).toBeInTheDocument()
  if (key === "{Escape}") await userEvent.keyboard(key)
  else await userEvent.click(screen.getByRole("button", { name: key }))
  await waitFor(() =>
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
  )
}

describe("useOpenerFocus", () => {
  it("returns focus to the button that started the review", async () => {
    render(<HookOpened />)
    const opener = screen.getByRole("button", {
      name: "Review lodging changes",
    })
    await userEvent.click(opener)
    await closeWith("Keep editing")
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("falls back to the given element for a sheet that opened on load", async () => {
    render(<HookOpened initiallyOpen />)
    await closeWith("{Escape}")
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Lodging" })).toHaveFocus()
    )
  })

  it("drops focus to the page without it (the gap it closes)", async () => {
    render(<HookOpened initiallyOpen wired={false} />)
    await closeWith("{Escape}")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(document.activeElement).toBe(document.body)
  })
})

describe("ReviewedWriteSheet finalFocus", () => {
  it("returns focus to the given element when a state-opened sheet closes", async () => {
    render(<StateOpened withFinalFocus />)
    await userEvent.click(
      screen.getByRole("button", { name: "Review lodging changes" })
    )
    expect(await screen.findByRole("dialog")).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Review lodging changes" })
      ).toHaveFocus()
    )
  })
})

function RestoredLodgingReview() {
  const [open, setOpen] = useState(true)
  const workflow: ReviewedChangeWorkflow = {
    review: {
      id: "review-1",
      approvedBy: null,
      expiresAt: "2999-01-01T00:00:00Z",
      locationName: "Corner House",
      targetResourceName: "locations/1",
      canApprove: true,
      requiresSecondApprover: false,
    } as unknown as GbpChangeSet,
    outcome: null,
    busy: false,
    error: null,
    open,
    uncertain: false,
    unresolved: false,
    stale: false,
    selectionRevision: 0,
    approve: () => {},
    send: () => {},
    check: () => {},
    setOpen,
  }
  return (
    <>
      <section id="section-saved-lodging">
        <button type="button">Open lodging review</button>
      </section>
      <ReviewedChangeSheet
        workflow={workflow}
        noun="lodging"
        rows={[]}
        disabled={false}
        savedWorkId="section-saved-lodging"
      />
    </>
  )
}

describe("ReviewedChangeSheet", () => {
  it("puts focus in the saved lodging work when a restored review closes", async () => {
    render(<RestoredLodgingReview />)
    await closeWith("Keep editing")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Open lodging review" })
      ).toHaveFocus()
    )
  })
})
