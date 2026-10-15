import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { Button } from "@/components/ui/button"
import { OptionRow, OptionRowGroup } from "@/components/ui/option-row"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import {
  Sheet,
  SheetBack,
  SheetBody,
  SheetContent,
  SheetDescription,
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

function ReminderSheet({
  onOpenChange,
  onSchedule,
}: {
  onOpenChange?: (open: boolean) => void
  onSchedule?: () => void
}) {
  const [open, setOpen] = useState(true)
  const [page, setPage] = useState<"root" | "custom">("root")
  const [choice, setChoice] = useState("tomorrow")
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        setOpen(next)
      }}
    >
      <SheetContent variant="inset">
        {page === "root" ? (
          <SheetHeader page={page}>
            <SheetTitle>Set reminder</SheetTitle>
          </SheetHeader>
        ) : (
          <SheetHeader
            page={page}
            back={
              <SheetBack to="Set reminder" onClick={() => setPage("root")} />
            }
            action={<Button onClick={onSchedule}>Schedule</Button>}
          >
            <SheetTitle>Custom date</SheetTitle>
          </SheetHeader>
        )}
        <SheetBody>
          {page === "root" ? (
            <>
              <OptionRowGroup label="Remind me">
                <OptionRow
                  indicator="radio"
                  label="Tomorrow"
                  description="Wed 15 Oct, 09:00 · venue time"
                  selected={choice === "tomorrow"}
                  onClick={() => setChoice("tomorrow")}
                />
                <OptionRow
                  indicator="radio"
                  label="Next Monday"
                  selected={choice === "monday"}
                  onClick={() => setChoice("monday")}
                />
              </OptionRowGroup>
              <OptionRow
                indicator="chevron"
                label="Custom date"
                onClick={() => setPage("custom")}
              />
            </>
          ) : (
            <p>Pick a date</p>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  )
}

describe("Sheet variant=inset", () => {
  it("floats inset above the dock on a phone, rounded on every corner, with a grabber", async () => {
    asPhone(true)
    render(<ReminderSheet />)
    const sheet = await screen.findByRole("dialog", { name: "Set reminder" })
    expect(sheet).toHaveAttribute("data-variant", "inset")
    expect(sheet).toHaveAttribute("data-presentation", "inset")
    expect(sheet).toHaveClass("rounded-sheet-inset")
    expect(sheet.className).toContain(
      "mb-[calc(var(--np-dock-bottom)+var(--np-sheet-inset))]"
    )
    expect(sheet.className).toContain("w-[calc(100%-2*var(--np-sheet-inset))]")
    // Not the edge sheet's top-only radius.
    expect(sheet.className).not.toContain("rounded-t-")
    const header = sheet.querySelector('[data-slot="sheet-header"]')!
    expect(
      header.querySelector('[data-slot="overlay-grabber"]')
    ).toHaveAttribute("aria-hidden", "true")
    // The title is the title role, semibold, left-aligned.
    const title = within(sheet).getByRole("heading", { name: "Set reminder" })
    expect(title).toHaveClass("text-title", "font-semibold")
    expect(
      header.querySelector('[data-slot="sheet-header-title"]')
    ).toHaveClass("items-start", "text-left")
    // Without a header action, the close button is the trailing control.
    expect(
      within(sheet).getByRole("button", { name: "Close" })
    ).toBeInTheDocument()
  })

  it("presents as the centred dialog from sm", async () => {
    asPhone(false)
    render(<ReminderSheet />)
    const sheet = await screen.findByRole("dialog", { name: "Set reminder" })
    expect(sheet).toHaveAttribute("data-presentation", "dialog")
    expect(sheet).toHaveAttribute("data-variant", "inset")
    expect(
      sheet.querySelector('[data-slot="overlay-grabber"]')
    ).not.toBeInTheDocument()
  })

  it("has 44px option rows that are the whole hit area, chosen with Enter or Space", async () => {
    asPhone(true)
    const user = userEvent.setup()
    render(<ReminderSheet />)
    const group = await screen.findByRole("radiogroup", { name: "Remind me" })
    const tomorrow = within(group).getByRole("radio", { name: "Tomorrow" })
    const monday = within(group).getByRole("radio", { name: "Next Monday" })
    expect(tomorrow).toHaveClass("min-h-(--np-touch)", "w-full")
    expect(tomorrow).toHaveAttribute("aria-checked", "true")
    expect(tomorrow).toHaveAccessibleDescription(
      "Wed 15 Oct, 09:00 · venue time"
    )
    monday.focus()
    await user.keyboard("{Enter}")
    expect(monday).toHaveAttribute("aria-checked", "true")
    expect(tomorrow).toHaveAttribute("aria-checked", "false")
    tomorrow.focus()
    await user.keyboard(" ")
    expect(tomorrow).toHaveAttribute("aria-checked", "true")
  })

  it("closes on Escape", async () => {
    asPhone(true)
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<ReminderSheet onOpenChange={onOpenChange} />)
    await screen.findByRole("dialog", { name: "Set reminder" })
    await user.keyboard("{Escape}")
    expect(onOpenChange).toHaveBeenCalledWith(false)
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Set reminder" })
      ).not.toBeInTheDocument()
    )
  })

  it("pushes a page in the sheet: labelled back, left title, one header action, focus on the new title", async () => {
    asPhone(true)
    const user = userEvent.setup()
    const onSchedule = vi.fn()
    render(<ReminderSheet onSchedule={onSchedule} />)
    const sheet = await screen.findByRole("dialog", { name: "Set reminder" })

    const custom = within(sheet).getByRole("button", { name: "Custom date" })
    custom.focus()
    await user.keyboard("{Enter}")

    const title = await within(sheet).findByRole("heading", {
      name: "Custom date",
    })
    await waitFor(() => expect(title).toHaveFocus())
    expect(sheet.querySelector('[data-slot="sheet-header-title"]')).toHaveClass(
      "items-start",
      "text-left"
    )

    // The back control is named in full and starts with its visible word.
    const back = within(sheet).getByRole("button", {
      name: "Back to Set reminder",
    })
    expect(back).toHaveTextContent("Back")
    expect(back).toHaveClass("min-h-(--np-touch)", "min-w-(--np-touch)")

    // One confirm on the right, and Close is never gone (R2 A-S1, WCAG
    // 2.5.7): with a back control it sits beside the action.
    expect(
      within(sheet).getByRole("button", { name: "Close" })
    ).toBeInTheDocument()
    await user.click(within(sheet).getByRole("button", { name: "Schedule" }))
    expect(onSchedule).toHaveBeenCalledOnce()

    await user.click(back)
    const rootTitle = await within(sheet).findByRole("heading", {
      name: "Set reminder",
    })
    await waitFor(() => expect(rootTitle).toHaveFocus())
  })

  it("leaves the default (edge) sheet as it was", async () => {
    asPhone(true)
    render(
      <Sheet open>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <SheetBody>Body</SheetBody>
        </SheetContent>
      </Sheet>
    )
    const sheet = await screen.findByRole("dialog", { name: "Filters" })
    expect(sheet).toHaveAttribute("data-variant", "edge")
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    expect(sheet.className).toContain("rounded-t-(--np-radius-sheet)")
    expect(sheet).not.toHaveClass("rounded-sheet-inset")
    const title = within(sheet).getByRole("heading", { name: "Filters" })
    // Drop 2: one sheet title role for every variant (brief §4.3), so a
    // phone's edge bottom sheet matches the inset and full sheets.
    expect(title).toHaveClass("text-title", "font-semibold")
    expect(title).not.toHaveClass("text-section")
    // Script-focusable only (never a Tab stop), so an edge sheet can push too.
    expect(title).toHaveAttribute("tabindex", "-1")
    const header = sheet.querySelector('[data-slot="sheet-header"]')!
    expect(header).toHaveClass("p-5", "pr-14")
    expect(header).not.toHaveAttribute("data-variant")
  })

  it("draws the full variant at full height on a phone", async () => {
    asPhone(true)
    render(
      <Sheet open>
        <SheetContent variant="full">
          <SheetHeader>
            <SheetTitle>Tags</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    const sheet = await screen.findByRole("dialog", { name: "Tags" })
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    expect(sheet).toHaveClass("h-dvh")
  })
})

// FINAL-QA #4: in a centred header a long description took the whole row
// and the empty side columns collapsed to nothing, so Close drew over the
// words. The side tracks now keep a floor and Close sits in its own cell.
describe("Sheet bar header reserves the trailing close (FINAL-QA #4)", () => {
  it("keeps the close in its own track beside a long title and description", async () => {
    asPhone(true)
    render(
      <Sheet open>
        <SheetContent variant="inset">
          <SheetHeader>
            <SheetTitle>Choose a client</SheetTitle>
            <SheetDescription>
              Every review, listing and report on this screen will show this
              client. You can change it again as you make them.
            </SheetDescription>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    const sheet = await screen.findByRole("dialog", { name: "Choose a client" })
    const bar = sheet.querySelector('[data-slot="sheet-header-bar"]')!
    expect(bar).toHaveClass("grid")
    // The words take what the trailing control leaves, wrapping beside it.
    expect(bar.className).toContain("grid-cols-[minmax(0,1fr)_auto]")
    expect(bar.className).not.toContain("grid-cols-[1fr_auto_1fr]")
    const trailing = sheet.querySelector('[data-slot="sheet-header-trailing"]')!
    // The trailing cell keeps its control's width (no min-w-0 collapse).
    expect(trailing).not.toHaveClass("min-w-0")
    const close = within(sheet).getByRole("button", { name: "Close" })
    expect(trailing).toContainElement(close)
    // The words live in the middle cell only, never in the close's cell.
    const title = sheet.querySelector('[data-slot="sheet-header-title"]')!
    expect(title).toContainElement(
      sheet.querySelector('[data-slot="sheet-description"]') as HTMLElement
    )
    expect(title).not.toContainElement(close)
  })
})
