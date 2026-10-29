import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
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
    // Pressed is ink (chrome is ink; the accent is for the action).
    expect(pressed.className).toContain("bg-ink")
    expect(pressed.className).toContain("text-ink-inverse")
    expect(pressed.className).toContain("font-medium")
    expect(pressed.className).not.toContain("bg-accent-tint")
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

  it("keeps a rating star visible on the pressed ink fill in dark", () => {
    render(
      <>
        <FilterChip pressed>5</FilterChip>
        <FilterChip>4</FilterChip>
      </>
    )
    // The dark ink fill is near-white, where the rating amber is ~1.4:1;
    // only a pressed chip remaps the role, to its own label ink.
    expect(screen.getByRole("button", { name: "5" })).toHaveClass(
      "dark:[--np-rating:var(--np-ink-inverse)]"
    )
    expect(screen.getByRole("button", { name: "4" }).className).not.toContain(
      "--np-rating"
    )
  })

  it("names the remove control after the filter", async () => {
    const user = userEvent.setup()
    const onRemove = vi.fn()
    render(<FilterChip onRemove={onRemove}>5★</FilterChip>)
    const chip = screen.getByRole("button", { name: "Remove filter: 5★" })
    expect(chip).not.toHaveAttribute("aria-pressed")
    expect(chip).toHaveClass("bg-ink", "text-ink-inverse")
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

describe("FilterChip counts", () => {
  it("draws counts in sans tabular figures and alert counts in the danger ink", () => {
    render(
      <>
        <FilterChip count={12}>All</FilterChip>
        <FilterChip count={2} countTone="alert">
          Needs attention
        </FilterChip>
      </>
    )
    const plain = screen.getByText("12")
    expect(plain).toHaveClass("text-count", "tabular-nums")
    expect(plain.className).not.toContain("font-mono")
    expect(plain.className).not.toContain("text-danger-ink")
    const alert = screen.getByText("2")
    expect(alert).toHaveAttribute("data-tone", "alert")
    expect(alert).toHaveClass("text-danger-ink")
    // The word stays in the name: colour only reinforces it.
    expect(
      screen.getByRole("button", { name: "Needs attention 2" })
    ).toBeInTheDocument()
  })

  it("draws a pressed chip's count, alert or not, in the chip's inverse ink", () => {
    render(
      <FilterChip pressed count={1} countTone="alert">
        Failed
      </FilterChip>
    )
    const chip = screen.getByRole("button", { name: "Failed 1" })
    expect(chip).toHaveAttribute("data-active")
    expect(chip).toHaveClass("group/chip")
    // Danger ink when unpressed; the inverse ink at 400 on the ink fill.
    expect(screen.getByText("1")).toHaveClass(
      "text-danger-ink",
      "group-data-active/chip:text-ink-inverse",
      "group-data-active/chip:font-normal"
    )
  })
})

describe("FilterChip states", () => {
  it("draws disabled with the disabled roles, never faded", () => {
    render(<FilterChip disabled>Drafts</FilterChip>)
    const chip = screen.getByRole("button", { name: "Drafts" })
    expect(chip).toHaveClass(
      "disabled:bg-disabled",
      "disabled:text-disabled-ink"
    )
    expect(chip.className).not.toMatch(/opacity-/)
  })

  it("sinks on press on scale and colour only, with a reduced-motion fallback", () => {
    render(<FilterChip>Drafts</FilterChip>)
    const chip = screen.getByRole("button", { name: "Drafts" })
    expect(chip).toHaveClass(
      "motion-safe:active:scale-[0.97]",
      "duration-(--np-duration-fast)",
      "transition-[background-color,color,scale]"
    )
    expect(chip.className).not.toMatch(/transition-all/)
  })
})

function Applied({
  initial,
  onEmpty,
}: {
  initial: string[]
  onEmpty?: () => void
}) {
  const [filters, setFilters] = useState(initial)
  return (
    <>
      <FilterChipStrip aria-label="Applied" role="group" onEmpty={onEmpty}>
        {filters.map((filter) => (
          <FilterChip
            key={filter}
            onRemove={() =>
              setFilters((current) => current.filter((item) => item !== filter))
            }
          >
            {filter}
          </FilterChip>
        ))}
      </FilterChipStrip>
      <button type="button">Search</button>
    </>
  )
}

describe("FilterChipStrip focus handoff", () => {
  it("moves focus to the next chip when the focused one is removed", async () => {
    const user = userEvent.setup()
    render(<Applied initial={["5★", "Riverside", "With text"]} />)
    screen.getByRole("button", { name: "Remove filter: Riverside" }).focus()
    await user.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove filter: With text" })
      ).toHaveFocus()
    )
  })

  it("falls back to the previous chip when the last one is removed", async () => {
    const user = userEvent.setup()
    render(<Applied initial={["5★", "Riverside"]} />)
    screen.getByRole("button", { name: "Remove filter: Riverside" }).focus()
    await user.keyboard("{Enter}")
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Remove filter: 5★" })
      ).toHaveFocus()
    )
  })

  it("calls onEmpty when no chip is left, and never leaves focus on the body", async () => {
    const user = userEvent.setup()
    const onEmpty = vi.fn(() =>
      screen.getByRole("button", { name: "Search" }).focus()
    )
    render(<Applied initial={["5★"]} onEmpty={onEmpty} />)
    screen.getByRole("button", { name: "Remove filter: 5★" }).focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(onEmpty).toHaveBeenCalledOnce())
    expect(screen.getByRole("button", { name: "Search" })).toHaveFocus()
  })

  it("focuses the strip itself when no chip is left and there is no onEmpty", async () => {
    const user = userEvent.setup()
    render(<Applied initial={["5★"]} />)
    screen.getByRole("button", { name: "Remove filter: 5★" }).focus()
    await user.keyboard("{Enter}")
    const strip = screen.getByRole("group", { name: "Applied" })
    await waitFor(() => expect(strip).toHaveFocus())
    expect(strip).toHaveAttribute("tabindex", "-1")
  })

  it("leaves focus alone when the reader moved it elsewhere first", async () => {
    const { rerender } = render(
      <FilterChipStrip aria-label="Applied" role="group">
        <FilterChip onRemove={() => {}}>5★</FilterChip>
      </FilterChipStrip>
    )
    screen.getByRole("button", { name: "Remove filter: 5★" }).focus()
    const outside = document.createElement("button")
    document.body.append(outside)
    outside.focus()
    rerender(
      <FilterChipStrip aria-label="Applied" role="group">
        {null}
      </FilterChipStrip>
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(outside).toHaveFocus()
    outside.remove()
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
