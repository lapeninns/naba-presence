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
