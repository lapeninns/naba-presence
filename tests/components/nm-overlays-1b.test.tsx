import { act, render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ActionBar } from "@/components/ui/action-bar"
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  CommandDialog,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import { Popover, PopoverContent } from "@/components/ui/popover"
import { SelectionBar, SelectionBarTile } from "@/components/ui/selection-bar"
import {
  Sheet,
  SheetBack,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/** jsdom has no matchMedia: answer the phone query the way a phone would. */
function asPhone(phone: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === PHONE_OVERLAY_QUERY ? phone : false,
    media: query,
    onchange: null,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("CommandDialog phone takeover (F1)", () => {
  function Palette({
    onOpenChange,
  }: {
    onOpenChange?: (open: boolean) => void
  }) {
    const [open, setOpen] = useState(true)
    return (
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next)
          setOpen(next)
        }}
        title="Search"
        phone="takeover"
      >
        <CommandInput
          placeholder="Search reviews"
          wrapperClassName="caller-row"
          trailing={<button type="button">Clear search</button>}
        />
        <CommandList>
          <CommandGroup heading="Results">
            <CommandItem>Old Crown</CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    )
  }

  it("is one CSS-switched element: the desk dialog, full screen below sm, whatever the media query says", async () => {
    // Even where script would say "phone", the takeover is not the sheet:
    // its phone drawing is CSS only.
    asPhone(true)
    render(<Palette />)
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    expect(dialog).toHaveAttribute("data-presentation", "dialog")
    expect(dialog).toHaveAttribute("data-phone", "takeover")
    expect(dialog.querySelector('[data-slot="overlay-grabber"]')).toBeNull()
    // Desk: the palette's own placement.
    expect(dialog).toHaveClass("top-[12vh]", "w-[min(620px,calc(100vw-24px))]")
    // Phone: the whole screen, square, under the status bar.
    expect(dialog).toHaveClass(
      "max-sm:inset-0",
      "max-sm:h-dvh",
      "max-sm:rounded-none",
      "max-sm:pt-safe"
    )
  })

  it("puts a pill field and a text Cancel side by side on a phone; Cancel closes, and is hidden from sm", async () => {
    asPhone(false)
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<Palette onOpenChange={onOpenChange} />)
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    const bar = dialog.querySelector('[data-slot="command-takeover-bar"]')!
    expect(bar).toHaveClass("sm:contents")
    const row = bar.querySelector('[data-slot="command-search"]')!
    expect(row).toHaveClass("max-sm:rounded-pill", "max-sm:bg-fill-secondary")
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    expect(cancel).toHaveClass("sm:hidden")
    expect(cancel.parentElement).toBe(bar)
    await user.click(cancel)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("takes a wrapper className and a trailing slot on the search row", async () => {
    asPhone(false)
    render(<Palette />)
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    const row = dialog.querySelector('[data-slot="command-search"]')!
    expect(row).toHaveClass("caller-row")
    const clear = within(row as HTMLElement).getByRole("button", {
      name: "Clear search",
    })
    // After the field, inside the row.
    expect(
      row.querySelector('[data-slot="command-input"]')?.nextElementSibling
    ).toBe(clear)
  })

  // FINAL-QA #14: a placeholder longer than the phone pill ended mid-word.
  it("ends a placeholder too long for the field in an ellipsis, not a hard cut", async () => {
    asPhone(true)
    render(<Palette />)
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    const input = dialog.querySelector('[data-slot="command-input"]')!
    expect(input).toHaveClass("text-ellipsis", "min-w-0", "w-full")
  })

  it("labels groups in sentence case, caption size, medium, muted (D8)", async () => {
    asPhone(false)
    render(<Palette />)
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    const group = dialog.querySelector('[data-slot="command-group"]')!
    expect(group.className).toContain("[&_[cmdk-group-heading]]:text-caption")
    expect(group.className).toContain("[&_[cmdk-group-heading]]:font-medium")
    expect(group.className).toContain("[&_[cmdk-group-heading]]:text-ink-muted")
    expect(group.className).not.toContain("uppercase")
    expect(group.className).not.toContain("font-mono")
  })

  it("leaves the default palette without the takeover bar", async () => {
    asPhone(false)
    render(
      <CommandDialog open onOpenChange={() => {}}>
        <CommandInput placeholder="Search" />
      </CommandDialog>
    )
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    expect(dialog).not.toHaveAttribute("data-phone")
    expect(
      dialog.querySelector('[data-slot="command-takeover-bar"]')
    ).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull()
  })
})

describe("DropdownMenu indicatorPosition (F1)", () => {
  it("draws the ✓ after the label with indicatorPosition=end, and before it by default", async () => {
    asPhone(false)
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="crown">
            <DropdownMenuRadioItem value="crown" indicatorPosition="end">
              Old Crown
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="bell">The Bell</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
          <DropdownMenuCheckboxItem checked indicatorPosition="end">
            Show closed
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const crown = await screen.findByRole("menuitemradio", {
      name: "Old Crown",
    })
    expect(crown).toHaveAttribute("aria-checked", "true")
    expect(crown).toHaveAttribute("data-indicator-position", "end")
    const check = crown.querySelector('[data-slot="dropdown-menu-check"]')!
    expect(crown.lastElementChild).toBe(check)
    expect(check).toHaveAttribute("data-position", "end")
    expect(check).toHaveClass("ml-auto")
    expect(check).toHaveAttribute("aria-hidden", "true")

    const bell = screen.getByRole("menuitemradio", { name: "The Bell" })
    expect(bell).toHaveAttribute("data-indicator-position", "start")
    expect(bell.firstElementChild).toHaveAttribute(
      "data-slot",
      "dropdown-menu-check"
    )

    const closed = screen.getByRole("menuitemcheckbox", { name: "Show closed" })
    expect(closed.lastElementChild).toHaveAttribute("data-position", "end")
  })

  it("floats on the menu radius and the soft float shadow, opaque", async () => {
    asPhone(false)
    render(
      <DropdownMenu defaultOpen>
        <DropdownMenuContent>
          <DropdownMenuRadioGroup value="a">
            <DropdownMenuRadioItem value="a">A</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    const menu = await screen.findByRole("menu")
    const popup = menu.closest('[data-slot="dropdown-menu-content"]')!
    expect(popup).toHaveClass("rounded-menu", "shadow-np-float", "bg-surface")
  })
})

describe("Popover look (Drop 2)", () => {
  it("is an opaque panel on the menu radius with the float shadow", async () => {
    asPhone(false)
    render(
      <Popover defaultOpen>
        <PopoverContent>Body</PopoverContent>
      </Popover>
    )
    const body = await screen.findByText("Body")
    const popup = body.closest('[data-slot="popover-content"]')!
    expect(popup).toHaveClass("rounded-menu", "shadow-np-float", "bg-surface")
    expect(popup).not.toHaveClass("shadow-np-pop")
  })
})

describe("AlertDialog look (Drop 2)", () => {
  it("asks calmly: title-size 600 title, muted body, answers on its own surface", async () => {
    asPhone(false)
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Disconnect Google?</AlertDialogTitle>
          <AlertDialogDescription>Replies stop syncing.</AlertDialogDescription>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Cancel
            </AlertDialogClose>
            <Button variant="danger">Disconnect</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    const alert = await screen.findByRole("alertdialog", {
      name: "Disconnect Google?",
    })
    const title = within(alert).getByText("Disconnect Google?")
    expect(title).toHaveClass("text-title", "font-semibold", "text-ink")
    expect(within(alert).getByText("Replies stop syncing.")).toHaveClass(
      "text-ui",
      "text-ink-muted"
    )
    const footer = alert.querySelector('[data-slot="alert-dialog-footer"]')!
    // Still pinned and clear of the keyboard, but no sunken bar or hairline.
    expect(footer).toHaveAttribute("data-docked")
    expect(footer).toHaveClass("sticky", "bg-surface")
    expect(footer).not.toHaveClass("border-t")
    expect(footer).not.toHaveClass("bg-surface-alt")
    // The destructive answer keeps the danger button.
    expect(
      within(alert).getByRole("button", { name: "Disconnect" })
    ).toHaveAttribute("data-variant", "danger")
  })
})

describe("SheetHeader focus on a remounted pushed page (Drop 1 nit)", () => {
  function KeyedPages() {
    const [page, setPage] = useState<"root" | "custom">("root")
    return (
      <Sheet open>
        <SheetContent variant="inset">
          {page === "root" ? (
            <SheetHeader key="root" page="root">
              <SheetTitle>Set reminder</SheetTitle>
            </SheetHeader>
          ) : (
            <SheetHeader
              key="custom"
              page="custom"
              back={
                <SheetBack to="Set reminder" onClick={() => setPage("root")} />
              }
            >
              <SheetTitle>Custom date</SheetTitle>
            </SheetHeader>
          )}
          <SheetBody>
            {page === "root" ? (
              <OptionRow
                indicator="chevron"
                label="Custom date"
                onClick={() => setPage("custom")}
              />
            ) : (
              <p>Pick a date</p>
            )}
          </SheetBody>
        </SheetContent>
      </Sheet>
    )
  }

  it("focuses the new title when the caller mounts a new header per page, both ways", async () => {
    asPhone(true)
    const user = userEvent.setup()
    render(<KeyedPages />)
    const sheet = await screen.findByRole("dialog", { name: "Set reminder" })
    await user.click(within(sheet).getByRole("button", { name: "Custom date" }))
    const title = await within(sheet).findByRole("heading", {
      name: "Custom date",
    })
    await waitFor(() => expect(title).toHaveFocus())
    await user.click(
      within(sheet).getByRole("button", { name: "Back to Set reminder" })
    )
    const root = await within(sheet).findByRole("heading", {
      name: "Set reminder",
    })
    await waitFor(() => expect(root).toHaveFocus())
  })

  it("focuses the title of a sheet that opens straight onto a pushed page", async () => {
    asPhone(true)
    render(
      <Sheet open>
        <SheetContent variant="inset">
          <SheetHeader page="custom" back={<SheetBack to="Set reminder" />}>
            <SheetTitle>Custom date</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    const title = await screen.findByRole("heading", { name: "Custom date" })
    await waitFor(() => expect(title).toHaveFocus())
  })

  it("draws every variant's title in text-title 600", async () => {
    asPhone(true)
    render(
      <Sheet open>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    const title = await screen.findByRole("heading", { name: "Filters" })
    expect(title).toHaveClass("text-title", "font-semibold")
  })
})

describe("OptionRowGroup roving tabindex (Drop 1 nit)", () => {
  function Group({
    menu = false,
    applyOnChoose = false,
    chooseOnArrow,
    onChoose,
  }: {
    menu?: boolean
    applyOnChoose?: boolean
    chooseOnArrow?: boolean
    onChoose?: (value: string) => void
  }) {
    const [value, setValue] = useState("tomorrow")
    const choose = (next: string) => {
      onChoose?.(next)
      setValue(next)
    }
    return (
      <>
        <button type="button">Before</button>
        <OptionRowGroup
          label="Remind me"
          menu={menu}
          applyOnChoose={applyOnChoose}
          chooseOnArrow={chooseOnArrow}
        >
          {["today", "tomorrow", "monday"].map((option) => (
            <OptionRow
              key={option}
              indicator="radio"
              label={option}
              selected={value === option}
              onClick={() => choose(option)}
            />
          ))}
        </OptionRowGroup>
        <button type="button">After</button>
      </>
    )
  }

  it("is one Tab stop, on the selected row", async () => {
    const user = userEvent.setup()
    render(<Group />)
    const [today, tomorrow, monday] = screen.getAllByRole("radio")
    expect(tomorrow).toHaveAttribute("tabindex", "0")
    expect(today).toHaveAttribute("tabindex", "-1")
    expect(monday).toHaveAttribute("tabindex", "-1")
    screen.getByRole("button", { name: "Before" }).focus()
    await user.tab()
    expect(tomorrow).toHaveFocus()
    await user.tab()
    expect(screen.getByRole("button", { name: "After" })).toHaveFocus()
    await user.tab({ shift: true })
    expect(tomorrow).toHaveFocus()
  })

  it("is a listbox whose arrows only move focus with applyOnChoose, so an apply-on-choose sheet is safe", async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<Group applyOnChoose onChoose={onChoose} />)
    screen.getByRole("listbox", { name: "Remind me" })
    expect(screen.queryByRole("radio")).not.toBeInTheDocument()
    const [today, tomorrow, monday] = screen.getAllByRole("option")
    expect(tomorrow).toHaveAttribute("aria-selected", "true")
    expect(tomorrow).not.toHaveAttribute("aria-checked")
    expect(tomorrow).toHaveAttribute("tabindex", "0")
    expect(today).toHaveAttribute("tabindex", "-1")
    tomorrow!.focus()
    await user.keyboard("{ArrowDown}")
    expect(monday).toHaveFocus()
    expect(monday).toHaveAttribute("aria-selected", "false")
    await user.keyboard("{ArrowRight}")
    expect(today).toHaveFocus()
    await user.keyboard("{ArrowLeft}")
    expect(monday).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
    await user.keyboard("{Enter}")
    expect(onChoose).toHaveBeenCalledWith("monday")
    await user.keyboard("{ArrowUp} ")
    expect(onChoose).toHaveBeenLastCalledWith("tomorrow")
  })

  it("chooses the row the arrow keys land on by default (APG radio pattern)", async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<Group onChoose={onChoose} />)
    screen.getByRole("radiogroup", { name: "Remind me" })
    const [today, tomorrow, monday] = screen.getAllByRole("radio")
    tomorrow!.focus()
    await user.keyboard("{ArrowDown}")
    expect(monday).toHaveFocus()
    expect(monday).toHaveAttribute("aria-checked", "true")
    expect(monday).toHaveAttribute("tabindex", "0")
    expect(tomorrow).toHaveAttribute("tabindex", "-1")
    await user.keyboard("{ArrowRight}")
    expect(today).toHaveFocus()
    expect(onChoose).toHaveBeenLastCalledWith("today")
    await user.keyboard("{ArrowLeft}")
    expect(monday).toHaveFocus()
    expect(onChoose).toHaveBeenLastCalledWith("monday")
    // Home and End move without choosing.
    onChoose.mockClear()
    await user.keyboard("{Home}")
    expect(today).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it("only moves focus when chooseOnArrow is turned off", async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<Group chooseOnArrow={false} onChoose={onChoose} />)
    const [today, tomorrow, monday] = screen.getAllByRole("radio")
    tomorrow!.focus()
    await user.keyboard("{ArrowDown}")
    expect(monday).toHaveFocus()
    // Left and Right move too, even without choosing.
    await user.keyboard("{ArrowRight}")
    expect(today).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
  })

  it("only moves focus in a menu group; Enter chooses there", async () => {
    const user = userEvent.setup()
    const onChoose = vi.fn()
    render(<Group menu onChoose={onChoose} />)
    const rows = screen.getAllByRole("menuitemradio")
    expect(rows.filter((row) => row.tabIndex === 0)).toEqual([rows[1]])
    rows[1]!.focus()
    await user.keyboard("{ArrowDown}")
    expect(rows[2]).toHaveFocus()
    expect(onChoose).not.toHaveBeenCalled()
    expect(rows[2]).toHaveAttribute("tabindex", "0")
    await user.keyboard("{Enter}")
    expect(onChoose).toHaveBeenCalledWith("monday")
  })

  it("keeps every checkbox in the Tab order in a multiple group", () => {
    render(
      <OptionRowGroup type="multiple" label="Labels">
        <OptionRow indicator="checkbox" label="Food" />
        <OptionRow indicator="checkbox" label="Staff" />
      </OptionRowGroup>
    )
    for (const row of screen.getAllByRole("checkbox")) {
      expect(row).not.toHaveAttribute("tabindex")
    }
  })
})

describe("Shared DockSpacer (feedback note)", () => {
  it("keeps --np-dock-bar-h while any docked bar remains, and clears it after the last", () => {
    const root = document.documentElement
    const heights = new Map<string, number>([
      ["action-bar", 64],
      ["selection-bar", 120],
    ])
    const spy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const height = heights.get(this.dataset.slot ?? "") ?? 0
        return {
          top: 0,
          left: 0,
          right: 390,
          bottom: height,
          width: 390,
          height,
        } as DOMRect
      })
    const styles = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(() => ({ position: "fixed" }) as CSSStyleDeclaration)
    try {
      function Page({
        action,
        selection,
      }: {
        action: boolean
        selection: boolean
      }) {
        return (
          <>
            {action ? (
              <ActionBar
                dock
                status="1 change"
                primary={<Button>Save</Button>}
              />
            ) : null}
            {selection ? (
              <SelectionBar count={2} onCancel={() => {}}>
                <SelectionBarTile label="Done" />
              </SelectionBar>
            ) : null}
          </>
        )
      }
      const { rerender, unmount } = render(<Page action selection />)
      // Both fixed: the reservation is the taller bar.
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("120px")
      expect(
        document.querySelector('[data-slot="selection-bar-spacer"]')
      ).toHaveAttribute("aria-hidden")
      // The selection bar leaves first: the action bar's height stays.
      act(() => rerender(<Page action selection={false} />))
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("64px")
      // And the other way round.
      act(() => rerender(<Page action selection />))
      act(() => rerender(<Page action={false} selection />))
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("120px")
      unmount()
      expect(root.style.getPropertyValue("--np-dock-bar-h")).toBe("")
    } finally {
      spy.mockRestore()
      styles.mockRestore()
    }
  })
})
