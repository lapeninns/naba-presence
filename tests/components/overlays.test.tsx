import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Toaster, toast } from "@/components/ui/toast"

describe("Dialog", () => {
  it("opens with correct semantics and closes on Escape", async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>Edit hours</DialogTrigger>
        <DialogContent>
          <DialogTitle>Edit hours</DialogTitle>
          <DialogDescription>Weekly schedule for this location.</DialogDescription>
        </DialogContent>
      </Dialog>
    )
    await user.click(screen.getByRole("button", { name: "Edit hours" }))
    const dialog = await screen.findByRole("dialog", { name: "Edit hours" })
    expect(dialog).toHaveAccessibleDescription(
      "Weekly schedule for this location."
    )
    await user.keyboard("{Escape}")
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    // Base UI's DialogPopup defaults `finalFocus` to restoring focus to
    // whatever opened the dialog — verify the trigger gets focus back so
    // keyboard users don't lose their place after dismissing with Escape.
    expect(screen.getByRole("button", { name: "Edit hours" })).toHaveFocus()
  })
})

describe("Toast", () => {
  it("close button keeps its distinct accessible name", async () => {
    const user = userEvent.setup()
    function Fixture() {
      return (
        <Toaster>
          <Button
            onClick={() =>
              toast.add({ title: "Reply published", type: "success" })
            }
          >
            Fire
          </Button>
        </Toaster>
      )
    }
    render(<Fixture />)
    await user.click(screen.getByRole("button", { name: "Fire" }))
    expect(await screen.findByText("Reply published")).toBeInTheDocument()

    // Base UI's ToastClose sets `aria-hidden={!expanded && !hasFocus}` — a
    // collapsed/unhovered toast's close button is deliberately hidden from
    // the accessibility tree until it gains focus or the stack expands
    // (unrelated to this regression, and `aria-hidden` also makes
    // computeAccessibleName report an empty name regardless of aria-label,
    // so querying with `{ hidden: true }` alone can't see the real label
    // either). Tab to it the same way a keyboard/screen-reader user would:
    // from "Fire", one tab reaches the toast's own tabbable root, a second
    // reaches its close button.
    await user.tab()
    await user.tab()

    // Regression guard: ToastClose's default `render` Button used to carry
    // aria-label="Close" while ToastPrimitive.Close itself carried
    // aria-label="Close toast" — Base UI's render-prop merge resolves to the
    // render element's own aria-label, so the mismatch silently collapsed
    // the toast's distinct accessible name down to the generic "Close" also
    // used by Dialog/Sheet. Both sources must agree on "Close toast".
    expect(screen.getByRole("button", { name: "Close toast" })).toHaveFocus()
  })
})
