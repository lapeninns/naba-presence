import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  PROFILE_PAGE_SLOT,
  SectionNav,
} from "@/components/locations/profile/section-nav"

// jsdom has no layout and no IntersectionObserver: each section's top is set
// by hand and the observer's callback is fired by the test.
let fire: () => void = () => {}
const tops: Record<string, number> = {}
// The nav's box: a phone chip row by default (wide and short).
let navBox = { top: 52, width: 390, height: 48 }

class FakeIntersectionObserver {
  constructor(callback: () => void) {
    fire = () => callback()
  }
  observe() {}
  disconnect() {}
}

function Page() {
  return (
    <div data-slot={PROFILE_PAGE_SLOT}>
      <SectionNav
        entries={[
          { id: "section-a", label: "Identity" },
          { id: "section-b", label: "Contact" },
          { id: "section-c", label: "Description" },
        ]}
      />
      {["section-a", "section-b", "section-c"].map((id) => (
        <section key={id} id={id}>
          <h3 id={`${id}-heading`}>{id}</h3>
        </section>
      ))}
    </div>
  )
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver)
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
    function (this: Element) {
      if (this.getAttribute("data-slot") === "section-nav") {
        const { top, width, height } = navBox
        return {
          top,
          bottom: top + height,
          left: 0,
          right: width,
          width,
          height,
          x: 0,
          y: top,
          toJSON: () => ({}),
        } as DOMRect
      }
      const top = tops[this.id] ?? 0
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 0,
        width: 0,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    }
  )
})
afterEach(() => {
  navBox = { top: 52, width: 390, height: 48 }
  for (const id of Object.keys(tops)) delete tops[id]
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("SectionNav", () => {
  it("keeps a tapped section current when the jump lands it below the spy line", async () => {
    render(<Page />)
    const nav = await screen.findByRole("navigation", {
      name: "Profile sections",
    })
    const contact = await screen.findByRole("link", { name: "Contact" })

    await userEvent.click(contact)
    expect(contact).toHaveAttribute("aria-current", "location")
    expect(document.activeElement).toHaveAttribute("id", "section-b-heading")

    // The jump left Contact 60px under the chips; the section above it has
    // passed the line. The spy must not move the mark back to Identity.
    Object.assign(tops, {
      "section-a": -400,
      "section-b": 160,
      "section-c": 600,
    })
    act(() => fire())
    expect(contact).toHaveAttribute("aria-current", "location")

    // Once the person scrolls themselves, the spy takes over again.
    act(() => {
      window.dispatchEvent(new Event("wheel"))
      fire()
    })
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Identity" })).toHaveAttribute(
        "aria-current",
        "location"
      )
    )
    expect(nav).toBeInTheDocument()
  })

  it("keeps a tapped section in place while blocks load above it, until the person scrolls", async () => {
    const { container } = render(<Page />)
    const scrolled = vi.mocked(Element.prototype.scrollIntoView)
    await userEvent.click(
      await screen.findByRole("link", { name: "Description" })
    )
    expect(scrolled.mock.contexts.at(-1)).toHaveAttribute("id", "section-c")
    scrolled.mockClear()

    // Google's sections arrive above it.
    const slot = container.querySelector(`[data-slot="${PROFILE_PAGE_SLOT}"]`)!
    act(() => {
      slot.prepend(document.createElement("section"))
    })
    await waitFor(() =>
      expect(scrolled.mock.contexts.at(-1)).toHaveAttribute("id", "section-c")
    )

    // After the person scrolls, loading blocks no longer move the page.
    scrolled.mockClear()
    act(() => {
      window.dispatchEvent(new Event("wheel"))
      slot.prepend(document.createElement("section"))
    })
    await new Promise((resolve) => requestAnimationFrame(resolve))
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(scrolled).not.toHaveBeenCalled()
  })

  it("draws the spy line under a chip row but level with the top of a desk rail", async () => {
    render(<Page />)
    const identity = await screen.findByRole("link", { name: "Identity" })
    Object.assign(tops, { "section-a": 40, "section-b": 110, "section-c": 700 })

    // Phone chip row (52-100): Contact has passed the line under it.
    act(() => fire())
    expect(screen.getByRole("link", { name: "Contact" })).toHaveAttribute(
      "aria-current",
      "location"
    )

    // Desk rail from 0 to 500 beside the sections: its bottom is no line;
    // only Identity has reached its top.
    navBox = { top: 0, width: 200, height: 500 }
    act(() => fire())
    expect(identity).toHaveAttribute("aria-current", "location")
  })
})
