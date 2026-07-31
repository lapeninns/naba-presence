import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

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
