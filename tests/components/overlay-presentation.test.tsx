import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { PHONE_OVERLAY_QUERY } from "@/components/ui/overlay"
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"

/**
 * jsdom has no matchMedia, so overlays read the desk answer by default.
 * Stub it to answer the phone query (and nothing else) the way a phone in
 * portrait would.
 */
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

function EditDialog(
  props: Partial<React.ComponentProps<typeof DialogContent>> & {
    dirty?: boolean
    onDiscard?: () => void
    onOpenChange?: (open: boolean) => void
  }
) {
  const { dirty, onDiscard, onOpenChange, ...content } = props
  const [open, setOpen] = useState(true)
  return (
    <Dialog
      open={open}
      dirty={dirty}
      onDiscard={onDiscard}
      onOpenChange={(next) => {
        onOpenChange?.(next)
        setOpen(next)
      }}
    >
      <DialogContent {...content}>
        <DialogHeader>
          <DialogTitle>Edit link</DialogTitle>
        </DialogHeader>
        <input aria-label="Link" />
        <DialogFooter>
          <DialogClose render={<Button variant="secondary" />}>
            Cancel
          </DialogClose>
          <Button>Save link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

describe("Dialog presentation", () => {
  it("is a centred dialog on the desk", async () => {
    asPhone(false)
    render(<EditDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(dialog).toHaveAttribute("data-presentation", "dialog")
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')
    expect(footer).toHaveClass("flex-row", "justify-end")
  })

  it("is a bottom sheet on a phone, with a docked, stacked footer", async () => {
    asPhone(true)
    render(<EditDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(dialog).toHaveAttribute("data-presentation", "sheet")
    // The drag handle is drawn in the pinned header, and is not a control.
    const header = dialog.querySelector('[data-slot="dialog-header"]')!
    expect(header).toHaveClass("sticky")
    expect(
      header.querySelector('[data-slot="overlay-grabber"]')
    ).toHaveAttribute("aria-hidden", "true")
    const footer = dialog.querySelector('[data-slot="dialog-footer"]')!
    expect(footer).toHaveAttribute("data-docked")
    expect(footer).toHaveClass("sticky", "flex-col")
    // Padded clear of the keyboard and the home indicator.
    expect(footer.className).toContain("var(--overlay-dock,0px)")
  })

  it("keeps a pinned presentation at every width", async () => {
    asPhone(true)
    render(<EditDialog presentation="dialog" />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    expect(dialog).toHaveAttribute("data-presentation", "dialog")
  })

  it("pins the close button in the header", async () => {
    asPhone(true)
    render(<EditDialog />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    const header = dialog.querySelector('[data-slot="dialog-header"]')!
    expect(
      within(header as HTMLElement).getByRole("button", { name: "Close" })
    ).toBeInTheDocument()
    // Exactly one close button: the content does not draw a second.
    expect(
      within(dialog).getAllByRole("button", { name: "Close" })
    ).toHaveLength(1)
  })
})

describe("Dialog close guard", () => {
  it("closes on Escape while clean", async () => {
    const user = userEvent.setup()
    render(<EditDialog dirty={false} />)
    await screen.findByRole("dialog", { name: "Edit link" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
  })

  it("asks before Escape throws edits away, and keeps them on Keep editing", async () => {
    const user = userEvent.setup()
    const onOpenChange = vi.fn()
    render(<EditDialog dirty onOpenChange={onOpenChange} />)
    await screen.findByRole("dialog", { name: "Edit link" })
    await user.keyboard("{Escape}")
    const prompt = await screen.findByRole("alertdialog", {
      name: "Discard your changes?",
    })
    expect(onOpenChange).not.toHaveBeenCalled()
    await user.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(
      screen.getByRole("dialog", { name: "Edit link" })
    ).toBeInTheDocument()
    expect(onOpenChange).not.toHaveBeenCalled()
  })

  it("guards the header's close button and closes on Discard", async () => {
    const user = userEvent.setup()
    const onDiscard = vi.fn()
    const onOpenChange = vi.fn()
    render(
      <EditDialog dirty onDiscard={onDiscard} onOpenChange={onOpenChange} />
    )
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    const prompt = await screen.findByRole("alertdialog")
    await user.click(
      within(prompt).getByRole("button", { name: "Discard changes" })
    )
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit link" })).toBeNull()
    )
    expect(onDiscard).toHaveBeenCalledTimes(1)
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it("lets a footer Cancel close without asking", async () => {
    const user = userEvent.setup()
    render(<EditDialog dirty />)
    const dialog = await screen.findByRole("dialog", { name: "Edit link" })
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("guards an uncontrolled sheet too", async () => {
    const user = userEvent.setup()
    render(
      <Sheet defaultOpen dirty>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Schedule post</SheetTitle>
          </SheetHeader>
        </SheetContent>
      </Sheet>
    )
    await screen.findByRole("dialog", { name: "Schedule post" })
    await user.keyboard("{Escape}")
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument()
    expect(
      // Behind the nested prompt the sheet is inert, but still open.
      screen.getByRole("dialog", { name: "Schedule post", hidden: true })
    ).toBeInTheDocument()
  })
})

describe("Sheet presentation", () => {
  function renderSheet(side?: "left" | "right" | "bottom") {
    render(
      <Sheet defaultOpen>
        <SheetContent side={side}>
          <SheetHeader>
            <SheetTitle>Filters</SheetTitle>
          </SheetHeader>
          <SheetFooter>
            <Button>Done</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    )
    return screen.findByRole("dialog", { name: "Filters" })
  }

  it("is a right panel on the desk and a bottom sheet on a phone", async () => {
    asPhone(false)
    const panel = await renderSheet("right")
    expect(panel).toHaveAttribute("data-presentation", "panel")
    expect(panel.querySelector('[data-slot="overlay-grabber"]')).toBeNull()
  })

  it("rises from the bottom on a phone, with a handle and a docked footer", async () => {
    asPhone(true)
    const sheet = await renderSheet("right")
    expect(sheet).toHaveAttribute("data-presentation", "sheet")
    expect(sheet.querySelector('[data-slot="overlay-grabber"]')).not.toBeNull()
    const footer = sheet.querySelector('[data-slot="sheet-footer"]')!
    expect(footer).toHaveAttribute("data-docked")
    expect(footer).toHaveClass("flex-col")
  })

  it("is a left navigation drawer for side=left", async () => {
    asPhone(true)
    const drawer = await renderSheet("left")
    expect(drawer).toHaveAttribute("data-presentation", "drawer")
    // The classes the shell's own navigation drawer is drawn with.
    expect(drawer).toHaveClass("left-0", "w-[min(var(--np-drawer-w),86vw)]")
  })
})

describe("AlertDialog presentation", () => {
  function renderAlert() {
    render(
      <AlertDialog defaultOpen>
        <AlertDialogContent>
          <AlertDialogTitle>Delete reply?</AlertDialogTitle>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="secondary" />}>
              Cancel
            </AlertDialogClose>
            <Button variant="danger">Delete reply</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
    return screen.findByRole("alertdialog", { name: "Delete reply?" })
  }

  it("anchors to the bottom edge on a phone with stacked answers", async () => {
    asPhone(true)
    const alert = await renderAlert()
    expect(alert).toHaveAttribute("data-presentation", "sheet")
    const footer = alert.querySelector('[data-slot="alert-dialog-footer"]')!
    expect(footer).toHaveClass("flex-col")
    expect(footer).toHaveAttribute("data-docked")
  })

  it("is centred on the desk", async () => {
    asPhone(false)
    const alert = await renderAlert()
    expect(alert).toHaveAttribute("data-presentation", "dialog")
  })
})
