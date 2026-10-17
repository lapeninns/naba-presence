import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { SectionCard } from "@/components/locations/profile/section-card"

// Tailwind is not loaded in jsdom, so this pins the classes. The rendered
// box is checked in a real browser by tests/e2e/listings.spec.ts ("profile
// section headings at 390").
const SR_ONLY_RULE = "[data-slot=settings-group-label]]:sr-only"

describe("SectionCard on a phone", () => {
  it("keeps its heading and caption drawn by default", () => {
    render(
      <SectionCard id="section-lodging" title="Lodging" description="Rooms">
        <p>fields</p>
      </SectionCard>
    )
    const group = document.getElementById("section-lodging")!
    expect(group.className).not.toContain(SR_ONLY_RULE)
    expect(group.className).not.toContain("caption]]:sr-only")
    expect(group.className).not.toContain("first-of-type")
    expect(
      screen.getByRole("heading", { level: 3, name: "Lodging" })
    ).toBeInTheDocument()
  })

  it("turns the heading and caption into screen-reader text only when asked", () => {
    render(
      <SectionCard
        id="section-identity"
        title="Identity"
        description="The name customers see."
        quietOnPhone
      >
        <p>fields</p>
      </SectionCard>
    )
    const group = document.getElementById("section-identity")!
    expect(group.className).toContain(SR_ONLY_RULE)
    expect(group.className).toContain("caption]]:sr-only")
    // From `desk` they are put back.
    expect(group.className).toContain(
      `desk:[&>div:first-child>${SR_ONLY_RULE.replace("]]:sr-only", "]]:not-sr-only")}`
    )
    // The heading is still in the outline, and still the section nav's focus
    // target.
    expect(
      screen.getByRole("heading", { level: 3, name: "Identity" })
    ).toHaveAttribute("id", "section-identity-heading")
  })

  it("is not affected by being the first section inside its own wrapper", () => {
    // IndustryEditor and the catalogue handoff wrap a bare card in a div of
    // their own, which made it the first <section> of its parent.
    render(
      <div>
        <SectionCard id="section-lodging" title="Lodging">
          <p>fields</p>
        </SectionCard>
      </div>
    )
    expect(document.getElementById("section-lodging")!.className).not.toMatch(
      /sr-only/
    )
  })
})
