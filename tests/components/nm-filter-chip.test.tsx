import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { FilterChip, FilterChipStrip } from "@/components/ui/chip"
import { TabNav, Tabs, TabsList, TabsTab, TextTabs } from "@/components/ui/tabs"

describe("FilterChip", () => {
  it("is a toggle reporting aria-pressed", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    const { rerender } = render(
      <FilterChip pressed={false} onClick={onClick}>
        Needs reply
      </FilterChip>
    )
    const chip = screen.getByRole("button", { name: "Needs reply" })
    expect(chip).toHaveAttribute("aria-pressed", "false")
    expect(chip.className).toContain("bg-fill-secondary")
    await user.click(chip)
    expect(onClick).toHaveBeenCalledTimes(1)
    rerender(
      <FilterChip pressed onClick={onClick}>
        Needs reply
      </FilterChip>
    )
    const pressed = screen.getByRole("button", { name: "Needs reply" })
    expect(pressed).toHaveAttribute("aria-pressed", "true")
    expect(pressed.className).toContain("bg-accent-tint")
    expect(pressed.className).toContain("text-accent-ink")
    expect(pressed.className).toContain("font-semibold")
  })

  it("is 28px drawn with a 44px touch hit", () => {
    render(<FilterChip>5★</FilterChip>)
    const chip = screen.getByRole("button", { name: "5★" })
    expect(chip.className).toContain("h-(--np-chip-h)")
    expect(chip.className).toContain(
      "after:inset-y-[calc((100%-var(--np-touch))/2)]"
    )
    expect(chip.className).toContain("rounded-(--np-radius-pill)")
  })

  it("names the remove control after the filter", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<FilterChip onRemove={onRemove}>5★</FilterChip>)
    const chip = screen.getByRole("button", { name: "Remove filter: 5★" })
    expect(chip).not.toHaveAttribute("aria-pressed")
    expect(chip.className).toContain("bg-accent-tint")
    await user.click(chip)
    expect(onRemove).toHaveBeenCalledTimes(1)
    chip.focus()
    await user.keyboard("{Enter}")
    await user.keyboard(" ")
    expect(onRemove).toHaveBeenCalledTimes(3)
  })

  it("reads the label from nested elements and accepts an override", () => {
    render(
      <>
        <FilterChip onRemove={() => {}}>
          <span>Venue:</span> <b>Riverside</b>
        </FilterChip>
        <FilterChip onRemove={() => {}} removeLabel="Clear the rating filter">
          1–2★
        </FilterChip>
      </>
    )
    expect(
      screen.getByRole("button", { name: "Remove filter: Venue: Riverside" })
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Clear the rating filter" })
    ).toBeInTheDocument()
  })

  it("sits in a sideways-scrolling strip", () => {
    render(
      <FilterChipStrip aria-label="Filters" role="group">
        <FilterChip>One</FilterChip>
      </FilterChipStrip>
    )
    const strip = screen.getByRole("group", { name: "Filters" })
    expect(strip).toHaveAttribute("data-slot", "filter-chip-strip")
    expect(strip.className).toContain("overflow-x-auto")
  })
})

describe("Text tabs", () => {
  it("marks the current link with aria-current and the underline, counts in text-count", () => {
    render(
      <TextTabs
        aria-label="Queues"
        items={[
          {
            href: "/inbox?q=needs",
            label: "Needs reply",
            count: 12,
            current: true,
          },
          { href: "/inbox?q=drafts", label: "Drafts", count: 3 },
        ]}
      />
    )
    const nav = screen.getByRole("navigation", { name: "Queues" })
    expect(nav).toHaveAttribute("data-variant", "text")
    const current = screen.getByRole("link", { name: "Needs reply 12" })
    expect(current).toHaveAttribute("aria-current", "page")
    expect(current.className).toContain("aria-[current=page]:font-semibold")
    expect(current.className).toContain("aria-[current=page]:after:bg-ink")
    expect(current.className).toContain("text-ink-secondary")
    expect(current.className).toContain("h-11")
    expect(screen.getByText("12").className).toContain("text-count")
    expect(screen.getByRole("link", { name: "Drafts 3" })).not.toHaveAttribute(
      "aria-current"
    )
  })

  it("keeps the line variant as the TabNav default", () => {
    render(
      <TabNav
        aria-label="Areas"
        items={[{ href: "/a", label: "Profile", current: true }]}
      />
    )
    const nav = screen.getByRole("navigation", { name: "Areas" })
    expect(nav).not.toHaveAttribute("data-variant")
    expect(screen.getByRole("link", { name: "Profile" }).className).toContain(
      "text-ink-muted"
    )
  })

  it("draws in-page tabs as text tabs with aria-selected", async () => {
    const user = userEvent.setup()
    render(
      <Tabs defaultValue="a">
        <TabsList variant="text" aria-label="Sections">
          <TabsTab value="a">Overview</TabsTab>
          <TabsTab value="b">Activity</TabsTab>
        </TabsList>
      </Tabs>
    )
    const overview = screen.getByRole("tab", { name: "Overview" })
    expect(overview).toHaveAttribute("aria-selected", "true")
    expect(overview.className).toContain("data-active:after:bg-ink")
    expect(overview.className).toContain("text-body")
    await user.click(screen.getByRole("tab", { name: "Activity" }))
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true"
    )
  })
})
