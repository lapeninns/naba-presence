import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CalendarIcon } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import {
  OptionRow,
  OptionRowGroup,
  OptionSeparator,
} from "@/components/ui/option-row"

describe("OptionRow", () => {
  it("is one 44px button whose label and sub-label name and describe it", () => {
    render(
      <OptionRow
        label="Custom date"
        description="Pick a date and time"
        icon={<CalendarIcon data-testid="icon" />}
        indicator="chevron"
      />
    )
    const row = screen.getByRole("button", { name: "Custom date" })
    expect(row.tagName).toBe("BUTTON")
    expect(row).toHaveAttribute("type", "button")
    // An inset ring: a sheet body or menu that clips can't cut it off.
    expect(row).toHaveClass("min-h-(--np-touch)", "w-full", "focus-ring-inset")
    expect(row).not.toHaveClass("focus-halo")
    expect(row).toHaveAccessibleDescription("Pick a date and time")
    expect(row).not.toHaveAttribute("aria-checked")
    expect(screen.getByText("Pick a date and time")).toHaveClass(
      "text-caption",
      "text-ink-muted"
    )
    // The leading icon slot is 20px and decorative.
    const icon = row.querySelector('[data-slot="option-row-icon"]')!
    expect(icon).toHaveClass("size-5")
    expect(icon).toHaveAttribute("aria-hidden", "true")
    expect(
      row.querySelector('[data-slot="option-row-chevron"]')
    ).toBeInTheDocument()
  })

  it("is a radio in a radiogroup, chosen with Enter and Space, arrows move and choose", async () => {
    const user = userEvent.setup()
    const choose = vi.fn()
    render(
      <OptionRowGroup label="Reply as">
        <OptionRow
          indicator="radio"
          label="Public reply"
          selected
          onClick={() => choose("public")}
        />
        <OptionRow
          indicator="radio"
          label="Internal note"
          onClick={() => choose("note")}
        />
        <OptionRow
          indicator="radio"
          label="Send for approval"
          onClick={() => choose("approval")}
        />
      </OptionRowGroup>
    )
    screen.getByRole("radiogroup", { name: "Reply as" })
    const public_ = screen.getByRole("radio", { name: "Public reply" })
    const note = screen.getByRole("radio", { name: "Internal note" })
    const approval = screen.getByRole("radio", { name: "Send for approval" })
    expect(public_).toHaveAttribute("aria-checked", "true")
    expect(note).toHaveAttribute("aria-checked", "false")

    public_.focus()
    await user.keyboard("{ArrowDown}")
    expect(note).toHaveFocus()
    // APG radio: the arrow chooses the row it lands on.
    expect(choose).toHaveBeenLastCalledWith("note")
    choose.mockClear()
    await user.keyboard("{Enter}")
    expect(choose).toHaveBeenLastCalledWith("note")
    await user.keyboard("{ArrowDown}")
    expect(approval).toHaveFocus()
    await user.keyboard(" ")
    expect(choose).toHaveBeenLastCalledWith("approval")
    await user.keyboard("{ArrowDown}")
    expect(public_).toHaveFocus()
    await user.keyboard("{End}")
    expect(approval).toHaveFocus()
    await user.keyboard("{Home}")
    expect(public_).toHaveFocus()
  })

  it("draws ✓ only on the selected check row", () => {
    render(
      <OptionRowGroup label="Sort by">
        <OptionRow indicator="check" label="Newest" selected />
        <OptionRow indicator="check" label="Lowest rating" />
      </OptionRowGroup>
    )
    const newest = screen.getByRole("radio", { name: "Newest" })
    const lowest = screen.getByRole("radio", { name: "Lowest rating" })
    expect(
      newest.querySelector('[data-slot="option-row-check"] svg')
    ).toBeInTheDocument()
    expect(
      lowest.querySelector('[data-slot="option-row-check"] svg')
    ).not.toBeInTheDocument()
  })

  it("is a checkbox for several-at-once rows", async () => {
    const user = userEvent.setup()
    const toggle = vi.fn()
    render(
      <OptionRow
        indicator="checkbox"
        label="Only if still unanswered"
        selected={false}
        onClick={toggle}
      />
    )
    const box = screen.getByRole("checkbox", {
      name: "Only if still unanswered",
    })
    expect(box).toHaveAttribute("aria-checked", "false")
    await user.click(box)
    expect(toggle).toHaveBeenCalledOnce()
  })

  it("takes the menuitem roles inside a menu group", () => {
    render(
      <div role="menu" aria-label="Reply type">
        <OptionRowGroup menu>
          <OptionRow indicator="check" label="Public reply" selected />
          <OptionRow indicator="checkbox" label="Notify team" />
          <OptionRow label="Copy link" />
        </OptionRowGroup>
      </div>
    )
    expect(
      screen.getByRole("menuitemradio", { name: "Public reply" })
    ).toHaveAttribute("aria-checked", "true")
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Notify team" })
    ).toHaveAttribute("aria-checked", "false")
    screen.getByRole("menuitem", { name: "Copy link" })
  })

  it("draws the destructive row in danger ink, after a separator", () => {
    render(
      <>
        <OptionRow label="Edit tags" />
        <OptionSeparator />
        <OptionRow tone="destructive" label="Remove reminder" />
      </>
    )
    expect(screen.getByRole("separator")).toBeInTheDocument()
    const remove = screen.getByRole("button", { name: "Remove reminder" })
    expect(remove).toHaveAttribute("data-tone", "destructive")
    expect(remove.className).toContain(
      "data-[tone=destructive]:text-danger-ink"
    )
  })

  it("does not fire when disabled", async () => {
    const user = userEvent.setup()
    const onClick = vi.fn()
    render(<OptionRow label="Tomorrow" disabled onClick={onClick} />)
    await user.click(screen.getByRole("button", { name: "Tomorrow" }))
    expect(onClick).not.toHaveBeenCalled()
  })
})
