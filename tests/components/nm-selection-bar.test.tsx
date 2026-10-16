import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { CheckIcon, SendIcon, TagIcon } from "lucide-react"
import { describe, expect, it, vi } from "vitest"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { SelectionBar, SelectionBarTile } from "@/components/ui/selection-bar"

function renderBar(
  props: Partial<React.ComponentProps<typeof SelectionBar>> = {}
) {
  const onCancel = vi.fn()
  const onDone = vi.fn()
  const onApprove = vi.fn()
  const utils = render(
    <SelectionBar count={3} onCancel={onCancel} {...props}>
      <SelectionBarTile
        icon={<CheckIcon aria-hidden />}
        label="Done"
        onClick={onDone}
      />
      <SelectionBarTile icon={<TagIcon aria-hidden />} label="Tag" />
      <SelectionBarTile
        tone="charcoal"
        icon={<SendIcon aria-hidden />}
        label="Approve"
        onClick={onApprove}
      />
    </SelectionBar>
  )
  return { ...utils, onCancel, onDone, onApprove }
}

describe("SelectionBar", () => {
  it("names its region and toolbar, and announces the count politely", () => {
    renderBar()
    expect(
      screen.getByRole("region", { name: "Selection actions" })
    ).toBeInTheDocument()
    const toolbar = screen.getByRole("toolbar", { name: "Actions" })
    expect(within(toolbar).getAllByRole("button")).toHaveLength(3)
    const count = screen.getByText("3 selected")
    expect(count).toHaveAttribute("aria-live", "polite")
    expect(count.className).toContain("text-title")
  })

  it("holds only its actions when given neither a count nor a Cancel", () => {
    render(
      <SelectionBar label="Selected reviews">
        <SelectionBarTile label="Done" />
      </SelectionBar>
    )
    const bar = screen.getByRole("region", { name: "Selected reviews" })
    expect(bar.querySelector('[data-slot="selection-bar-header"]')).toBeNull()
    expect(bar.querySelector('[data-slot="selection-bar-cancel"]')).toBeNull()
    expect(
      within(screen.getByRole("toolbar", { name: "Actions" })).getAllByRole(
        "button"
      )
    ).toHaveLength(1)
  })

  it("takes a custom count label and hides when not visible", () => {
    const { rerender } = render(
      <SelectionBar
        count={1}
        countLabel="1 review selected"
        onCancel={() => {}}
      />
    )
    expect(screen.getByText("1 review selected")).toBeInTheDocument()
    rerender(<SelectionBar count={0} visible={false} onCancel={() => {}} />)
    expect(
      document.querySelector('[data-slot="selection-bar"]')
    ).not.toBeInTheDocument()
  })

  it("docks to the bottom on a phone the way ActionBar does, hiding the tab bar", () => {
    renderBar()
    const bar = document.querySelector(
      '[data-slot="selection-bar"]'
    ) as HTMLElement
    // The CHROME CONTRACT attribute: globals.css hides the tab bar for it,
    // and the toast stack and scroll padding clear it.
    expect(bar).toHaveAttribute("data-docked", "bottom")
    expect(bar.className).toContain("max-md:fixed")
    expect(bar.className).toContain("max-md:bottom-0")
    expect(bar.className).toContain(
      "max-md:pb-[max(--spacing(2),var(--np-dock-bottom))]"
    )
    // In-flow reservation so the last row stays reachable.
    const spacer = bar.previousElementSibling as HTMLElement
    expect(spacer).toHaveAttribute("data-slot", "selection-bar-spacer")
    expect(spacer).toHaveAttribute("aria-hidden")
  })

  it("stays inline when not docked", () => {
    renderBar({ dock: false })
    const bar = document.querySelector(
      '[data-slot="selection-bar"]'
    ) as HTMLElement
    expect(bar).not.toHaveAttribute("data-docked")
    expect(bar.className).not.toContain("max-md:fixed")
    expect(
      document.querySelector('[data-slot="selection-bar-spacer"]')
    ).toBeNull()
  })

  it("sizes tiles at 64px and Cancel at 44px on touch", () => {
    renderBar()
    for (const tile of screen.getAllByRole("button", {
      name: /Done|Tag|Approve/,
    })) {
      expect(tile.className).toContain("min-h-16")
      expect(tile.className).toContain("min-w-16")
      expect(tile.className).toContain("text-caption")
      expect(tile.className).toContain("flex-col")
    }
    const cancel = screen.getByRole("button", { name: "Cancel" })
    expect(cancel.className).toContain("min-h-(--np-touch)")
    expect(cancel.className).toContain("min-w-(--np-touch)")
  })

  it("draws the publish tile in the charcoal tone", () => {
    renderBar()
    const approve = screen.getByRole("button", { name: "Approve" })
    expect(approve).toHaveAttribute("data-tone", "charcoal")
    expect(approve.className).toContain("on-charcoal")
    expect(screen.getByRole("button", { name: "Done" })).toHaveAttribute(
      "data-tone",
      "default"
    )
  })

  it("is one Tab stop with arrow keys between tiles, and Cancel ends the selection", async () => {
    const user = userEvent.setup()
    const { onCancel, onDone, onApprove } = renderBar()
    // Tab order: Cancel (header), then the toolbar.
    await user.tab()
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus()
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("button", { name: "Tag" })).toHaveFocus()
    await user.keyboard("{ArrowRight}")
    const approve = screen.getByRole("button", { name: "Approve" })
    expect(approve).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(onApprove).toHaveBeenCalledOnce()
    // Focus wraps from the last tile to the first.
    await user.keyboard("{ArrowRight}")
    expect(screen.getByRole("button", { name: "Done" })).toHaveFocus()
    await user.keyboard(" ")
    expect(onDone).toHaveBeenCalledOnce()
    // One Tab stop: Tab leaves the toolbar rather than visiting each tile.
    await user.tab()
    expect(screen.getByRole("button", { name: "Tag" })).not.toHaveFocus()
    expect(screen.getByRole("toolbar")).not.toContainElement(
      document.activeElement as HTMLElement
    )

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it("shows notes above the header", () => {
    renderBar({ notes: "1 of these is not ready for your approval." })
    const notes = document.querySelector(
      '[data-slot="selection-bar-notes"]'
    ) as HTMLElement
    expect(notes).toHaveTextContent(
      "1 of these is not ready for your approval."
    )
    expect(notes.className).toContain("text-caption")
  })

  it("takes a tile as a menu trigger, so an overflow is a tile too", async () => {
    const user = userEvent.setup()
    render(
      <SelectionBar count={2} onCancel={() => {}}>
        <DropdownMenu>
          <DropdownMenuTrigger render={<SelectionBarTile label="More" />} />
          <DropdownMenuContent>
            <DropdownMenuItem>Assign…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SelectionBar>
    )
    const more = screen.getByRole("button", { name: "More" })
    // The trigger keeps its own data-slot; the tile brings its look.
    expect(more).toHaveAttribute("data-tone", "default")
    expect(more.className).toContain("min-h-16")
    await user.click(more)
    expect(
      await screen.findByRole("menuitem", { name: "Assign…" })
    ).toBeInTheDocument()
  })
})
