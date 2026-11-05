import { render, screen, within } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar, DispatchBar, SaveBar } from "@/components/ui/action-bar"
import { Button } from "@/components/ui/button"
import { ChangeTrack, trackStops } from "@/components/ui/change-track"
import { StatusPill } from "@/components/ui/status-pill"
import {
  OUTCOME_PRESENTATION,
  type PresentedState,
} from "@/lib/editors/outcome"

const STATES = Object.keys(OUTCOME_PRESENTATION) as PresentedState[]

afterEach(() => {
  vi.restoreAllMocks()
})

describe("StatusPill driven by a lifecycle state", () => {
  it.each(STATES)("%s: the shared label, tone and glyph", (state) => {
    const presentation = OUTCOME_PRESENTATION[state]
    const { container } = render(
      <StatusPill state={state} values={{ time: "10:42" }} />
    )
    const pill = container.querySelector('[data-slot="status-pill"]')!
    expect(pill.getAttribute("data-state")).toBe(state)
    expect(pill.getAttribute("data-tone")).toBe(presentation.tone)
    expect(pill.className).toContain("rounded-(--np-radius-pill)")
    expect(
      pill.querySelector(`svg[data-glyph="${presentation.glyph}"]`)
    ).not.toBeNull()
    expect(pill.textContent).toBe(presentation.label.replace("{time}", "10:42"))
  })

  it("never says published or live in a state label", () => {
    for (const state of STATES) {
      expect(OUTCOME_PRESENTATION[state].label).not.toMatch(/published|live/i)
    }
  })

  it("speaks the state for the dot variant", () => {
    render(<StatusPill state="failed" variant="dot" />)
    expect(screen.getByText("Failed: retry")).toHaveClass("sr-only")
  })

  it("keeps the tone API for pills that are not lifecycle states", () => {
    const { container } = render(<StatusPill tone="ok">Verified</StatusPill>)
    const pill = container.querySelector('[data-slot="status-pill"]')!
    expect(pill.getAttribute("data-tone")).toBe("ok")
    expect(pill.querySelector("svg")).toBeNull()
  })
})

describe("ChangeTrack", () => {
  const states = (state: PresentedState, approval?: "skipped") =>
    trackStops(state, { approval })?.map((stop) => stop.state)

  it("places each state on the four stops (DIRECTION §6.1)", () => {
    expect(states("saved_locally")).toEqual(["current", "todo", "todo", "todo"])
    expect(states("blocked")).toEqual(["done", "failed", "todo", "todo"])
    expect(states("awaiting_approval")).toEqual([
      "done",
      "current",
      "todo",
      "todo",
    ])
    expect(states("approved")).toEqual(["done", "done", "current", "todo"])
    expect(states("awaiting_confirmation")).toEqual([
      "done",
      "done",
      "done",
      "current",
    ])
    expect(states("confirmed_applied")).toEqual([
      "done",
      "done",
      "done",
      "reached",
    ])
    expect(states("failed")).toEqual(["done", "done", "failed", "todo"])
    expect(states("rejected")).toEqual(["done", "done", "failed", "todo"])
  })

  it("draws nothing for a state that is not a Google step", () => {
    for (const state of [
      "unsaved",
      "conflict",
      "withdrawn",
      "expired",
      "replaced",
    ] as const) {
      expect(trackStops(state)).toBeNull()
      const { container } = render(<ChangeTrack state={state} />)
      expect(container.firstChild).toBeNull()
    }
  })

  it("says Not needed for a skipped approval, never a silent tick", () => {
    render(<ChangeTrack state="awaiting_confirmation" approval="skipped" />)
    const list = screen.getByRole("list", { name: "Where this change is" })
    const approved = within(list).getAllByRole("listitem")[1]!
    expect(approved).toHaveAttribute("data-state", "skipped")
    expect(approved).toHaveTextContent("Not needed")
    expect(approved).not.toHaveTextContent("Approved")
  })

  it("labels a failed stop with the state's pill words in danger ink", () => {
    render(<ChangeTrack state="failed" />)
    const sent = screen
      .getAllByRole("listitem")
      .find((item) => item.getAttribute("data-stop") === "sent")!
    expect(sent).toHaveAttribute("data-state", "failed")
    expect(sent).toHaveAttribute("aria-current", "step")
    expect(within(sent).getByText("Failed: retry")).toHaveClass(
      "text-danger-ink"
    )
  })

  it("keeps green for the reached On Google stop only", () => {
    const { container } = render(<ChangeTrack state="confirmed_applied" />)
    const green = container.querySelectorAll(".text-success-ink")
    expect(green.length).toBeGreaterThan(0)
    for (const node of green) {
      expect(node.closest("li")).toHaveAttribute("data-stop", "google")
    }
  })

  it("speaks every stop in the compact form", () => {
    render(<ChangeTrack state="awaiting_approval" compact />)
    const items = screen.getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Saved here, done",
      "Approved, current step",
      "Sent, not sent yet",
      "On Google, not sent yet",
    ])
  })

  it("speaks an unconfirmed On Google stop as waiting for Google", () => {
    render(<ChangeTrack state="awaiting_confirmation" compact />)
    const items = screen.getAllByRole("listitem")
    expect(items.map((item) => item.textContent)).toEqual([
      "Saved here, done",
      "Approved, done",
      "Sent, done",
      "On Google, waiting for Google",
    ])
    expect(items[3]).toHaveAttribute("aria-current", "step")
    expect(items[3]).toHaveAttribute("data-state", "current")
  })

  it("draws to-do stops in ink-muted, readable without their labels", () => {
    const { container } = render(<ChangeTrack state="saved_locally" compact />)
    const todo = container.querySelectorAll('[data-glyph="todo"]')
    expect(todo).toHaveLength(3)
    for (const glyph of todo) {
      expect(glyph).toHaveClass("text-ink-muted")
      expect(glyph).not.toHaveClass("text-ink-quaternary")
    }
  })
})

describe("DispatchBar and SaveBar", () => {
  it("draws the dispatch bar on charcoal with the state's long form", () => {
    const { container } = render(
      <DispatchBar
        state="awaiting_confirmation"
        detail="We check again every 2 minutes."
        primary={<Button variant="send">Check again</Button>}
      />
    )
    const bar = screen.getByRole("region", { name: "Send to Google" })
    expect(bar).toHaveAttribute("data-bar-tone", "charcoal")
    expect(bar.className).toContain("on-charcoal")
    expect(bar).toHaveTextContent("Sent, waiting for Google to confirm")
    expect(container.querySelector('svg[data-glyph="hourglass"]')).toHaveClass(
      "text-info-on-charcoal"
    )
  })

  it("draws the save bar on the surface with the unsaved count", () => {
    render(<SaveBar count={2} primary={<Button>Save</Button>} />)
    const bar = screen.getByRole("region", { name: "Save changes" })
    expect(bar).toHaveAttribute("data-bar-tone", "surface")
    expect(bar.className).not.toContain("on-charcoal")
    expect(bar).toHaveTextContent("2 unsaved changes")
    expect(bar).toHaveTextContent("Saving keeps them in NabaPresence only")
  })

  it("keeps a docked bar's headline and sub-line apart on a phone", () => {
    const docked = (statusRow: boolean) =>
      render(
        <DispatchBar
          dock
          statusRow={statusRow}
          state="saved_locally"
          detail="Nothing changes on Google until you publish."
          primary={<Button variant="on-dark">Review changes</Button>}
        />
      )
    const { unmount } = docked(false)
    const bar = screen.getByRole("region", { name: "Send to Google" })
    const status = bar.querySelector<HTMLElement>(
      '[data-slot="action-bar-status"]'
    )!
    // Clamping the shared wrapper drew it as one -webkit-box and ran the
    // two lines together; the headline clamps alone.
    expect(status.className).not.toMatch(/\[&>:not\(svg\)\]:line-clamp/)
    expect(status.className).toContain(
      "max-md:[&>:not(svg):not([data-slot=action-bar-status-text])]:line-clamp-2"
    )
    expect(status.className).toContain(
      "max-md:[&_[data-slot=action-bar-status-title]]:line-clamp-2"
    )
    // The sub-line is still read out, and a narrow phone wraps the status
    // to its own row rather than clamp it to a word.
    expect(
      within(status).getByText("Nothing changes on Google until you publish.")
    ).toHaveAttribute("data-slot", "action-bar-status-detail")
    expect(status.className).toContain(
      "max-md:[&_[data-slot=action-bar-status-detail]]:sr-only"
    )
    expect(status.className).toContain("max-md:min-w-28")
    expect(bar.className).toMatch(/max-md:flex-wrap/)
    unmount()
    // With its own row the status has room: no clamp, sub-line shown.
    docked(true)
    const row = screen
      .getByRole("region", { name: "Send to Google" })
      .querySelector<HTMLElement>('[data-slot="action-bar-status"]')!
    expect(row.className).toContain("max-md:basis-full")
    expect(row.className).not.toMatch(/line-clamp|sr-only/)
  })

  it("keeps a failed save's reason on screen in a docked save bar", () => {
    render(
      <SaveBar
        dock
        count={1}
        error="The server didn't answer."
        primary={<Button>Save</Button>}
      />
    )
    expect(screen.getByText("The server didn't answer.")).toHaveAttribute(
      "data-slot",
      "action-bar-status-error"
    )
  })

  it("fails loudly when an ink button is the charcoal bar's primary", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<ActionBar tone="charcoal" primary={<Button>Save</Button>} />)
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("cannot be the primary of a charcoal")
    )
  })

  it("accepts a send primary or secondaries only on charcoal", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    render(
      <>
        <ActionBar
          tone="charcoal"
          primary={<Button variant="send">Publish 2 changes</Button>}
        />
        <DispatchBar
          state="confirmed_applied"
          label="Confirmed"
          secondaryActions={[{ label: "View on Google", href: "/x" }]}
        />
      </>
    )
    expect(error).not.toHaveBeenCalled()
  })
})
