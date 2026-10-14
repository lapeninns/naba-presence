import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { ListRow, ListRows } from "@/components/ui/list-row"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import {
  Sheet,
  SheetBack,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { ToastLink } from "@/components/ui/toast"
import { Toolbar } from "@/components/ui/toolbar"

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

function ActionSheet({
  back,
  onOpenChange,
}: {
  back?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        setOpen(next)
      }}
    >
      <SheetContent variant="inset">
        <SheetHeader
          back={back ? <SheetBack to="Reminder" /> : undefined}
          action={<Button size="sm">Done</Button>}
        >
          <SheetTitle>Category</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  )
}

describe("R2 A-S1: a sheet header action keeps a named Close", () => {
  it("an inset sheet with an action still has a 'Close' button", async () => {
    asPhone(true)
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ActionSheet onOpenChange={onOpenChange} />)
    expect(
      await screen.findByRole("button", { name: "Done" })
    ).toBeInTheDocument()
    const close = screen.getByRole("button", { name: "Close" })
    await user.click(close)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("keeps the back control in the leading slot when there is one", async () => {
    asPhone(true)
    render(<ActionSheet back />)
    expect(
      await screen.findByRole("button", { name: "Back to Reminder" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument()
  })

  it("keeps Close beside the action on a pushed page with a back control", async () => {
    asPhone(true)
    render(<ActionSheet back />)
    expect(
      await screen.findByRole("button", { name: "Back to Reminder" })
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument()
  })

  it("draws a visible inset focus ring on the title (A-N1)", async () => {
    asPhone(true)
    render(<ActionSheet />)
    const title = await screen.findByRole("heading", { name: "Category" })
    expect(title).toHaveClass(
      "focus-visible:ring-2",
      "focus-visible:ring-inset",
      "forced-colors:focus-visible:outline-2"
    )
  })
})

describe("R2 A-N4: the toolbar results region exists before its first label", () => {
  it("mounts an empty status region, then announces into it", () => {
    const { rerender } = render(<Toolbar searchLabel="Search reviews" />)
    const status = screen.getByRole("status")
    expect(status).toBeEmptyDOMElement()
    rerender(<Toolbar searchLabel="Search reviews" resultsLabel="3 results" />)
    expect(screen.getByRole("status")).toBe(status)
    expect(status).toHaveTextContent("3 results")
  })
})

describe("R2 A-N5: toast links are https only and say they open a tab", () => {
  it("renders an https link with its new-tab warning", () => {
    render(<ToastLink href="https://business.google.com/r/1" />)
    const link = screen.getByRole("link", {
      name: "View on Google (opens in a new tab)",
    })
    expect(link).toHaveAttribute("target", "_blank")
    expect(link).toHaveAttribute("rel", "noopener noreferrer")
  })

  it.each([
    "javascript:alert(1)",
    "http://example.com",
    "data:text/html,x",
    "",
  ])("renders nothing for %j", (href) => {
    render(<ToastLink href={href} />)
    expect(screen.queryByRole("link")).toBeNull()
  })
})

describe("ListRows listbox: one Tab stop, arrows move", () => {
  it("roves focus between options and drops non-option slots", async () => {
    const user = userEvent.setup()
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    render(
      <ListRows listbox aria-label="Venues">
        <ListRow title="The Bell" />
        <ListRow title="The Railway" selected />
        <ListRow title="The Old Crown" footer={<button>Approve</button>} />
      </ListRows>
    )
    const [bell, railway, crown] = screen.getAllByRole("option")
    expect(railway).toHaveAttribute("tabindex", "0")
    expect(bell).toHaveAttribute("tabindex", "-1")
    expect(crown).toHaveAttribute("tabindex", "-1")
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull()
    expect(warn).toHaveBeenCalled()
    railway!.focus()
    await user.keyboard("{ArrowDown}")
    expect(crown).toHaveFocus()
    await user.keyboard("{Home}")
    expect(bell).toHaveFocus()
    expect(bell).toHaveAttribute("tabindex", "0")
    warn.mockRestore()
  })
})
