import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { QuickFilters } from "@/components/inbox/filter-controls"
import type { InboxState } from "@/lib/inbox/url-state"

function renderQuick(props: Partial<Parameters<typeof QuickFilters>[0]> = {}) {
  const onChange = vi.fn()
  render(
    <QuickFilters
      ratings={[]}
      written={undefined}
      onChange={onChange}
      {...props}
    />
  )
  return { onChange }
}

function group() {
  return screen.getByRole("group", { name: "Quick filters" })
}

describe("QuickFilters", () => {
  it("is one labelled strip of five star chips and With text, as toggles", () => {
    renderQuick()
    const chips = within(group()).getAllByRole("button")
    expect(
      chips.map((chip) => chip.getAttribute("aria-label") ?? chip.textContent)
    ).toEqual([
      "5 stars",
      "4 stars",
      "3 stars",
      "2 stars",
      "1 star",
      "With text",
    ])
    for (const chip of chips) {
      expect(chip).toHaveAttribute("data-slot", "filter-chip")
      expect(chip).toHaveAttribute("aria-pressed", "false")
    }
    expect(group()).toHaveAttribute("data-slot", "inbox-quick-filters")
    // Scrolls sideways rather than wrapping or cutting a label.
    expect(group()).toHaveClass("overflow-x-auto")
  })

  it("turns a rating on in one tap", async () => {
    const user = userEvent.setup()
    const { onChange } = renderQuick()
    await user.click(within(group()).getByRole("button", { name: "5 stars" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ratings: [5] })
  })

  it("turns With text on in one tap", async () => {
    const user = userEvent.setup()
    const { onChange } = renderQuick()
    await user.click(within(group()).getByRole("button", { name: "With text" }))
    expect(onChange).toHaveBeenCalledWith({ written: "with_text" })
  })

  it("turns With text off in one tap when it is on", async () => {
    const user = userEvent.setup()
    const { onChange } = renderQuick({ written: "with_text" })
    const chip = within(group()).getByRole("button", { name: "With text" })
    expect(chip).toHaveAttribute("aria-pressed", "true")
    await user.click(chip)
    expect(onChange).toHaveBeenCalledWith({ written: undefined })
  })

  it("does not show With text as on for a rating-only link", () => {
    renderQuick({ written: "rating_only" })
    expect(
      within(group()).getByRole("button", { name: "With text" })
    ).toHaveAttribute("aria-pressed", "false")
  })

  it("supports several ratings from Home's rating=1,2 deep link", async () => {
    const user = userEvent.setup()
    const { onChange } = renderQuick({ ratings: [1, 2] })
    expect(
      within(group()).getByRole("button", { name: "1 star" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(group()).getByRole("button", { name: "2 stars" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(group()).getByRole("button", { name: "5 stars" })
    ).toHaveAttribute("aria-pressed", "false")
    await user.click(within(group()).getByRole("button", { name: "1 star" }))
    expect(onChange).toHaveBeenCalledWith({ ratings: [2] })
    await user.click(within(group()).getByRole("button", { name: "4 stars" }))
    expect(onChange).toHaveBeenLastCalledWith({ ratings: [4, 2, 1] })
  })

  it("filters to 5 stars with text in two taps", async () => {
    // Before: Filters, 5 stars, With text, "Show 1 review" (four taps).
    const user = userEvent.setup()
    let latest: Partial<InboxState> = {}
    function Harness() {
      const [state, setState] = useState<
        Pick<InboxState, "ratings" | "written">
      >({ ratings: [], written: undefined })
      return (
        <QuickFilters
          ratings={state.ratings}
          written={state.written}
          onChange={(partial) => {
            latest = { ...latest, ...partial }
            setState((current) => ({ ...current, ...partial }))
          }}
        />
      )
    }
    render(<Harness />)
    await user.click(within(group()).getByRole("button", { name: "5 stars" }))
    await user.click(within(group()).getByRole("button", { name: "With text" }))
    expect(latest).toEqual({ ratings: [5], written: "with_text" })
    expect(
      within(group()).getByRole("button", { name: "5 stars" })
    ).toHaveAttribute("aria-pressed", "true")
    expect(
      within(group()).getByRole("button", { name: "With text" })
    ).toHaveAttribute("aria-pressed", "true")
  })
})
