import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
} from "@/components/ui/combobox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
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

describe("Select", () => {
  it("floats by the trigger on the desk", async () => {
    asDevice("desk")
    const user = userEvent.setup()
    render(<SortSelect />)
    await user.click(screen.getByRole("combobox", { name: "Sort" }))
    const listbox = await screen.findByRole("listbox")
    expect(listbox.closest('[data-slot="select-content"]')).toHaveAttribute(
      "data-presentation",
      "popover"
    )
    expect(screen.queryByText("Sort by")).toBeNull()
  })

  it("is a bottom action sheet on a phone, with a title and Cancel", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(<SortSelect />)
    await user.click(screen.getByRole("combobox", { name: "Sort" }))
    const listbox = await screen.findByRole("listbox")
    const sheet = listbox.closest('[data-slot="select-content"]') as HTMLElement
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    expect(within(sheet).getByText("Sort by")).toBeInTheDocument()
    // The options are the listbox's; the title and Cancel sit outside it.
    expect(within(listbox).getAllByRole("option")).toHaveLength(2)
    expect(within(listbox).queryByRole("button")).toBeNull()
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull())
  })
})

describe("DropdownMenu", () => {
  function ActionsMenu() {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger>Actions</DropdownMenuTrigger>
        <DropdownMenuContent title="Reply actions">
          <DropdownMenuItem>Copy link</DropdownMenuItem>
          <DropdownMenuItem>Archive</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  it("is a bottom action sheet on a phone", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(<ActionsMenu />)
    await user.click(screen.getByRole("button", { name: "Actions" }))
    const menu = await screen.findByRole("menu")
    const sheet = menu.closest(
      '[data-slot="dropdown-menu-content"]'
    ) as HTMLElement
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    expect(within(sheet).getByText("Reply actions")).toBeInTheDocument()
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2)
    await user.click(within(sheet).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull())
  })

  it("floats on the desk", async () => {
    asDevice("desk")
    const user = userEvent.setup()
    render(<ActionsMenu />)
    await user.click(screen.getByRole("button", { name: "Actions" }))
    const menu = await screen.findByRole("menu")
    expect(menu).toHaveAttribute("data-presentation", "popover")
  })
})

describe("Popover", () => {
  it("rises as a sheet with a Close on a phone", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(
      <Popover>
        <PopoverTrigger>Switch client</PopoverTrigger>
        <PopoverContent aria-label="Switch client" className="w-72 p-0">
          <p>Clients</p>
        </PopoverContent>
      </Popover>
    )
    await user.click(screen.getByRole("button", { name: "Switch client" }))
    const body = (await screen.findByText("Clients")).closest(
      '[data-slot="popover-sheet-body"]'
    ) as HTMLElement
    // The caller's padding reaches the body; its desk width does not win.
    expect(body).toHaveClass("p-0", "w-full!")
    const sheet = body.closest('[data-slot="popover-content"]') as HTMLElement
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    await user.click(within(sheet).getByRole("button", { name: "Close" }))
    await waitFor(() => expect(screen.queryByText("Clients")).toBeNull())
  })
})

describe("Combobox", () => {
  const short = ["The Bell", "The Railway", "The White Horse"]
  const long = Array.from({ length: 12 }, (_, index) => `Listing ${index + 1}`)

  function Switcher({ items }: { items: string[] }) {
    return (
      <Combobox items={items} defaultValue={items[0]}>
        <ComboboxInput aria-label="Switch listing" />
        <ComboboxContent>
          {items.map((item) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          ))}
        </ComboboxContent>
      </Combobox>
    )
  }

  it("switches a short list without raising the keyboard on touch", async () => {
    asDevice("phone")
    const user = userEvent.setup()
    render(<Switcher items={short} />)
    const input = screen.getByRole("combobox", { name: "Switch listing" })
    expect(input).toHaveAttribute("inputmode", "none")
    await user.click(screen.getByRole("button", { name: "Show options" }))
    const listbox = await screen.findByRole("listbox")
    expect(listbox.closest('[data-slot="combobox-content"]')).toHaveAttribute(
      "data-presentation",
      "sheet"
    )
  })

  it("keeps a long list a search field", async () => {
    asDevice("phone")
    render(<Switcher items={long} />)
    const input = screen.getByRole("combobox", { name: "Switch listing" })
    expect(input).not.toHaveAttribute("inputmode")
  })

  // The chevron was a 24px button at every width; on touch it is a 44px
  // square (the project's touch floor) and the field leaves room for it.
  it("sizes the options button to the touch floor, compact only at the desk", () => {
    render(<Switcher items={short} />)
    const trigger = screen.getByRole("button", { name: "Show options" })
    expect(trigger).toHaveClass("size-(--np-touch)", "desk:size-6")
    expect(trigger.className).not.toMatch(/(^|\s)size-6(\s|$)/)
    const input = screen.getByRole("combobox", { name: "Switch listing" })
    expect(input).toHaveClass("pr-(--np-touch)", "desk:pr-8")
  })

  it("types freely on the desk", () => {
    asDevice("desk")
    render(<Switcher items={short} />)
    expect(
      screen.getByRole("combobox", { name: "Switch listing" })
    ).not.toHaveAttribute("inputmode")
  })
})
