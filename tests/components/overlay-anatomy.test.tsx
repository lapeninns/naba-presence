import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { CommandDialog, CommandInput } from "@/components/ui/command"
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { OverlayCancel, PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/** A phone (portrait, coarse pointer) or a desk (wide, fine pointer). */
function asDevice(device: "phone" | "desk") {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches:
      device === "phone" &&
      (query === PHONE_OVERLAY_QUERY || query === "(pointer: coarse)"),
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

const GRABBER = '[data-slot="overlay-grabber"]'

function SaveDialog({
  showCloseButton,
  hiddenHeader = false,
}: {
  showCloseButton?: boolean
  hiddenHeader?: boolean
}) {
  return (
    <Dialog defaultOpen>
      <DialogContent showCloseButton={showCloseButton}>
        <DialogHeader className={hiddenHeader ? "sr-only" : undefined}>
          <DialogTitle>Edit link</DialogTitle>
        </DialogHeader>
        <input aria-label="Link" />
        <DialogFooter>
          <OverlayCancel />
          <Button>Save link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe("The overlay recipe", () => {
  it("draws a left title and a ✕, and no Cancel beside it, with the confirm as the footer primary", async () => {
    asDevice("desk")
    render(<SaveDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(within(dialog).getByRole("heading")).toHaveClass(
      "text-left",
      "text-title",
      "font-semibold"
    )
    expect(
      within(dialog).getAllByRole("button", { name: "Close" })
    ).toHaveLength(1)
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull()
    // The footer holds the confirm alone, drawn as the primary.
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')!
    const buttons = within(footer as HTMLElement).getAllByRole("button")
    expect(buttons).toHaveLength(1)
    expect(buttons.at(-1)).toHaveTextContent("Save link")
    expect(buttons.at(-1)).toHaveClass("bg-primary")
  })

  it("offers a Cancel only where there is no ✕, first in the footer so the confirm stays last", async () => {
    asDevice("desk")
    const user = userEvent.setup()
    render(<SaveDialog showCloseButton={false} />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(within(dialog).queryByRole("button", { name: "Close" })).toBeNull()
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')!
    const buttons = within(footer as HTMLElement).getAllByRole("button")
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Cancel",
      "Save link",
    ])
    expect(buttons[1]).toHaveClass("bg-primary")
    await user.click(buttons[0])
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("puts the grabber on a phone dialog sheet, even when its header is visually hidden", async () => {
    asDevice("phone")
    const { unmount } = render(<SaveDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(dialog).toHaveAttribute("data-presentation", "sheet")
    expect(
      dialog
        .querySelector('[data-slot="dialog-header"]')!
        .querySelector(GRABBER)
    ).not.toBeNull()
    unmount()

    render(<SaveDialog hiddenHeader />)
    const hidden = await screen.findByRole("dialog", { name: "Edit link" })
    expect(hidden.querySelectorAll(GRABBER)).toHaveLength(1)
    // The fallback grabber is in the flow and first in the popup, so it
    // reserves its own height and never paints over the content or a control.
    const grabber = hidden.querySelector(GRABBER)!
    expect(grabber).not.toHaveClass("absolute")
    expect(hidden.firstElementChild).toBe(grabber)
    // The content still draws the one ✕ the hidden header left to it.
    expect(
      within(hidden).getAllByRole("button", { name: "Close" })
    ).toHaveLength(1)
  })

  it("leaves the phone command sheet exactly one grabber, drawn by the chrome", async () => {
    asDevice("phone")
    render(
      <CommandDialog
        open
        onOpenChange={() => {}}
        title="Search"
        description="Find a venue."
      >
        <CommandInput placeholder="Search venues" />
      </CommandDialog>
    )
    const dialog = await screen.findByRole("dialog", { name: "Search" })
    expect(dialog).toHaveAttribute("data-presentation", "sheet")
    expect(dialog.querySelectorAll(GRABBER)).toHaveLength(1)
    // Its Cancel (the sheet's only visible close) is never under the grabber.
    const grabber = dialog.querySelector(GRABBER)!
    const cancel = within(dialog).getByRole("button", { name: "Cancel" })
    expect(grabber).not.toHaveClass("absolute")
    expect(
      grabber.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it("draws no grabber on the desk dialog", async () => {
    asDevice("desk")
    render(<SaveDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(dialog.querySelector(GRABBER)).toBeNull()
  })

  it("puts the grabber, a left title and the ✕ on a phone sheet, with the confirm in the footer", async () => {
    asDevice("phone")
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <SheetBody>Body</SheetBody>
          <SheetFooter>
            <Button>Show results</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
    const sheet = await screen.findByRole("dialog", { name: "Filters" })
    expect(sheet.querySelectorAll(GRABBER)).toHaveLength(1)
    expect(within(sheet).getByRole("heading")).toHaveClass(
      "text-left",
      "text-title"
    )
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeVisible()
    expect(within(sheet).queryByRole("button", { name: "Cancel" })).toBeNull()
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')!
    expect(
      within(footer as HTMLElement)
        .getAllByRole("button")
        .at(-1)
    ).toHaveTextContent("Show results")
  })
})

describe("Menu and select sheets share the recipe", () => {
  function SortSelect() {
    return (
      <Select defaultValue="newest">
        <SelectTrigger aria-label="Sort">
          <SelectValue />
        </SelectTrigger>
        <SelectContent title="Sort by">
          <SelectItem value="newest">Newest</SelectItem>
          <SelectItem value="oldest">Oldest</SelectItem>
        </SelectContent>
      </Select>
    )
  }

  it("shows the required title on a phone select sheet, with a grabber and a ✕", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(<SortSelect />)
    await user.click(screen.getByRole("combobox", { name: "Sort" }))
    const listbox = await screen.findByRole("listbox")
    const sheet = listbox.closest('[data-slot="select-content"]') as HTMLElement
    expect(sheet.querySelectorAll(GRABBER)).toHaveLength(1)
    expect(within(sheet).getByText("Sort by")).toHaveAttribute(
      "data-slot",
      "menu-sheet-title"
    )
    expect(within(sheet).queryByRole("button", { name: "Cancel" })).toBeNull()
    await user.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
  })

  it("requires a title on SelectContent", () => {
    // The type is the contract: a phone sheet of options must say which
    // field it belongs to. Removing the directive below must fail typecheck.
    // @ts-expect-error `title` is required
    const element = <SelectContent>{null}</SelectContent>
    expect(element).toBeTruthy()
  })

  it("puts the grabber and a ✕ on a phone menu sheet, with or without a title", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
    await user.click(screen.getByRole("button", { name: "Actions" }))
    const menu = await screen.findByRole("menu")
    const sheet = menu.closest(
      '[data-slot="dropdown-menu-content"]'
    ) as HTMLElement
    expect(sheet.querySelectorAll(GRABBER)).toHaveLength(1)
    expect(sheet.querySelector('[data-slot="menu-sheet-title"]')).toBeNull()
    expect(within(sheet).queryByRole("button", { name: "Cancel" })).toBeNull()
    await user.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("puts the grabber on a phone popover sheet and a short combobox sheet", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    const { unmount } = render(
      <Popover>
        <PopoverTrigger>Switch client</PopoverTrigger>
        <PopoverContent title="Client" aria-label="Switch client">
          <p>Clients</p>
        </PopoverContent>
      </Popover>
    )
    await user.click(screen.getByRole("button", { name: "Switch client" }))
    const popover = (await screen.findByText("Clients")).closest(
      '[data-slot="popover-content"]'
    ) as HTMLElement
    expect(popover.querySelectorAll(GRABBER)).toHaveLength(1)
    expect(within(popover).getByText("Client")).toBeInTheDocument()
    unmount()

    render(
      <Combobox items={["The Bell", "The Railway"]} defaultValue="The Bell">
        <ComboboxInput aria-label="Switch listing" />
        <ComboboxContent title="Listing">
          {["The Bell", "The Railway"].map((item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    )
    await user.click(screen.getByRole("button", { name: "Show options" }))
    const listbox = await screen.findByRole("listbox")
    const sheet = listbox.closest(
      '[data-slot="combobox-content"]'
    ) as HTMLElement
    expect(sheet.querySelectorAll(GRABBER)).toHaveLength(1)
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeVisible()
  })

  it("keeps the desk select a floating popover with no sheet chrome", async () => {
    asDevice("desk")
    const user = userEvent.setup()
    render(<SortSelect />)
    await user.click(screen.getByRole("combobox", { name: "Sort" }))
    const listbox = await screen.findByRole("listbox")
    const popup = listbox.closest('[data-slot="select-content"]')!
    expect(popup).toHaveAttribute("data-presentation", "popover")
    expect(popup.querySelector(GRABBER)).toBeNull()
    expect(screen.queryByText("Sort by")).toBeNull()
  })
})
