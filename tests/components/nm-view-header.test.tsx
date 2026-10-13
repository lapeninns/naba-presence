import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ViewHeader } from "@/components/ui/view-header"

describe("ViewHeader", () => {
  it("renders the h1 with a muted count on the same line", () => {
    render(<ViewHeader title="Inbox" count="12" countLabel="12 need a reply" />)
    const heading = screen.getByRole("heading", { level: 1, name: "Inbox" })
    expect(heading.className).toContain("text-page-title")
    const count = document.querySelector('[data-slot="view-header-count"]')!
    expect(count.className).toContain("text-count")
    expect(count.className).toContain("font-normal")
    expect(count.className).toContain("text-ink-muted")
    // The figure is hidden from screen readers; the label says what it means.
    expect(screen.getByText("12")).toHaveAttribute("aria-hidden", "true")
    expect(screen.getByText("(12 need a reply)").className).toContain("sr-only")
  })

  it("reads a bare count as it is", () => {
    render(<ViewHeader title="Drafts" count={3} />)
    expect(screen.getByText("3")).not.toHaveAttribute("aria-hidden")
  })

  it("renders a labelled back link at least 44px tall", () => {
    render(
      <ViewHeader title="Review" back={{ href: "/inbox", label: "Inbox" }} />
    )
    const back = screen.getByRole("link", { name: "Back to Inbox" })
    expect(back).toHaveAttribute("href", "/inbox")
    expect(back).toHaveTextContent("Inbox")
    expect(back.className).toContain("min-h-(--np-touch)")
  })

  it("renders trailing actions and a decorative icon", () => {
    render(
      <ViewHeader
        title="Posts"
        icon={<svg data-testid="icon" />}
        actions={<button type="button">New post</button>}
      />
    )
    expect(screen.getByRole("button", { name: "New post" })).toBeInTheDocument()
    expect(
      screen.getByTestId("icon").closest('[data-slot="view-header-icon"]')
    ).toHaveAttribute("aria-hidden", "true")
  })

  it("can be sticky under the safe area", () => {
    render(<ViewHeader title="Inbox" sticky />)
    const header = screen.getByRole("banner")
    expect(header.className).toContain("sticky")
    expect(header.className).toContain("pt-safe")
    expect(header.className).toContain("z-sticky")
  })

  it("can render the title as a paragraph", () => {
    render(<ViewHeader title="Inbox" titleAs="p" />)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.getByText("Inbox").tagName).toBe("P")
  })
})
