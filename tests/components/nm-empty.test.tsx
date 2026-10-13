import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"

const root = (container: HTMLElement) =>
  container.querySelector('[data-slot="empty"]') as HTMLElement

describe("Empty (NM restyle)", () => {
  it("sets the title in text-title 500 and the reason in muted caption text", () => {
    render(
      <Empty
        title="All caught up"
        description="No reviews need a reply. New ones sync every 15 min."
      />
    )
    const title = screen.getByText("All caught up")
    expect(title.className).toContain("text-title")
    expect(title.className).toContain("font-medium")
    const description = screen.getByText(
      "No reviews need a reply. New ones sync every 15 min."
    )
    expect(description.className).toContain("text-caption")
    expect(description.className).toContain("text-ink-muted")
  })

  it("draws an illustration in place of the glyph, hidden from assistive tech", () => {
    const { container } = render(
      <Empty
        variant="error"
        title="Nothing matched"
        illustration={<EmptyIllustration name="search" />}
      />
    )
    const slot = container.querySelector(
      '[data-slot="empty-illustration"]'
    ) as HTMLElement
    expect(slot).toHaveAttribute("aria-hidden")
    // 112px (inside the 96–120px band), in the ink.
    expect(slot.className).toContain("size-28")
    expect(slot.className).toContain("text-ink")
    // The illustration replaces the variant's glyph mark.
    expect(root(container).querySelector(".lucide-circle-alert")).toBeNull()
  })

  it.each(["inbox-zero", "search"] as const)(
    "draws the %s illustration as 1.5 currentColor strokes, no fills",
    (name) => {
      const { container } = render(<EmptyIllustration name={name} />)
      const svg = container.querySelector("svg")!
      expect(svg).toHaveAttribute("data-name", name)
      expect(svg).toHaveAttribute("aria-hidden")
      expect(svg).toHaveAttribute("stroke", "currentColor")
      expect(svg).toHaveAttribute("stroke-width", "1.5")
      expect(svg).toHaveAttribute("fill", "none")
      // No literal colour anywhere in the drawing.
      expect(svg.outerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|oklch\(/i)
      for (const shape of svg.querySelectorAll("path, circle")) {
        expect(shape).toHaveAttribute("vector-effect", "non-scaling-stroke")
      }
    }
  )

  it("still draws a variant's glyph mark without an illustration", () => {
    const { container } = render(<Empty variant="forbidden" title="Hidden" />)
    expect(root(container).querySelector(".lucide-lock")).not.toBeNull()
    expect(
      container.querySelector('[data-slot="empty-illustration"]')
    ).toBeNull()
  })

  it("sits at about 35% of the page height in the page placement", () => {
    const { container } = render(
      <Empty placement="page" title="All caught up" />
    )
    const el = root(container)
    expect(el).toHaveAttribute("data-placement", "page")
    expect(el.className).toContain("before:grow-35")
    expect(el.className).toContain("after:grow-65")
    expect(el.className).toContain("justify-start")
  })

  it("is inline by default and keeps its one action reachable", () => {
    const { container } = render(
      <Empty
        title="No posts scheduled"
        action={<Button>Schedule a post</Button>}
      />
    )
    expect(root(container)).toHaveAttribute("data-placement", "inline")
    expect(root(container).className).not.toContain("before:grow-35")
    expect(
      screen.getByRole("button", { name: "Schedule a post" })
    ).toBeInTheDocument()
  })
})
