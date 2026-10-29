import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import { Empty, EmptyIllustration } from "@/components/ui/empty"

const root = (container: HTMLElement) =>
  container.querySelector('[data-slot="empty"]') as HTMLElement

describe("Empty (NM restyle)", () => {
  it("sets the title in text-title 600 ink and the reason in muted ui text", () => {
    render(
      <Empty
        title="All caught up"
        description="No reviews need a reply. New ones sync every 15 min."
      />
    )
    const title = screen.getByText("All caught up")
    expect(title.className).toContain("text-title")
    expect(title.className).toContain("font-semibold")
    expect(title.className).toContain("text-ink")
    const description = screen.getByText(
      "No reviews need a reply. New ones sync every 15 min."
    )
    expect(description.className).toContain("text-ui")
    expect(description.className).toContain("max-w-sm")
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

  it.each([
    ["neutral", "text-ink-muted"],
    ["ok", "text-success-ink"],
    ["bad", "text-danger-ink"],
    ["warn", "text-warning-ink"],
  ] as const)(
    "draws the glyph bare at 20px in the %s tone's ink, on no tinted square",
    (tone, ink) => {
      const { container } = render(
        <Empty variant="forbidden" tone={tone} title="Hidden" />
      )
      const icon = container.querySelector(
        '[data-slot="empty-icon"]'
      ) as HTMLElement
      expect(icon).toHaveAttribute("aria-hidden")
      expect(icon.className).toContain(ink)
      expect(icon.className).toContain("[&_svg]:size-5")
      expect(icon.className).toContain("[&_svg]:[stroke-width:1.75]")
      // Principle 5: no 44px tinted mark behind the glyph.
      expect(icon.className).not.toMatch(/(^|\s)(bg-|size-11|rounded)/)
    }
  )

  it("reads as a sentence in a frame: modest padding, not a hero", () => {
    const { container, rerender } = render(<Empty title="Nothing yet" />)
    expect(root(container).className).toContain("py-8")
    expect(root(container).className).not.toMatch(/lg:py-16|sm:py-12/)
    rerender(<Empty size="sm" title="Nothing yet" />)
    expect(root(container).className).toContain("py-5")
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

  it("takes an h1 title for a state that is the whole page", () => {
    render(<Empty titleAs="h1" placement="page" title="Page not found" />)
    expect(
      screen.getByRole("heading", { level: 1, name: "Page not found" })
    ).toBeInTheDocument()
  })

  it("keeps actions outside the alert, so it announces only what happened", () => {
    const { container } = render(
      <Empty
        variant="error"
        role="alert"
        title="We couldn't load this listing"
        description="Google didn't answer in time."
        actions={<Button>Try again</Button>}
      />
    )
    const alert = screen.getByRole("alert")
    expect(alert).toHaveAttribute("data-slot", "empty-message")
    expect(alert).toHaveTextContent("We couldn't load this listing")
    expect(alert).toHaveTextContent("Google didn't answer in time.")
    const retry = screen.getByRole("button", { name: "Try again" })
    expect(alert).not.toContainElement(retry)
    // The outer element keeps the layout and the slot, and is not live.
    expect(root(container)).not.toHaveAttribute("role")
    expect(root(container)).toContainElement(retry)
    expect(retry.closest('[data-slot="empty-actions"]')).not.toBeNull()
  })

  it("keeps the old shape without actions: role and action on the one element", () => {
    const { container } = render(
      <Empty
        variant="error"
        role="alert"
        title="Failed"
        action={<Button>Retry</Button>}
      />
    )
    expect(root(container)).toHaveAttribute("role", "alert")
    expect(container.querySelector('[data-slot="empty-message"]')).toBeNull()
    expect(root(container)).toContainElement(
      screen.getByRole("button", { name: "Retry" })
    )
  })
})
