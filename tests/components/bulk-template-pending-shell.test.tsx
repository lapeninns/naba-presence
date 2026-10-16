import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { batch, release, renderBar, settledDialog } from "./bulk-template-held"

const { heldImport } = await vi.hoisted(() => import("./bulk-template-gate"))
vi.mock("@/components/inbox/template-dialog-loader", () => ({
  importTemplateReplyDialog: () => heldImport(),
}))

describe("the template batch while its code is on the way", () => {
  it("is a modal from the click, and closing it cancels the open for good", async () => {
    const user = userEvent.setup()
    renderBar()
    const primary = await screen.findByRole("button", {
      name: "Reply with template",
    })
    await user.click(primary)

    // The code has not arrived (the deferred is held), and the batch is
    // already a modal question.
    const shell = await settledDialog()
    expect(shell).toHaveTextContent("Loading…")

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
    // Focus goes back to the control that asked, not to the page.
    expect(primary).toHaveFocus()

    // The code arriving afterwards does not open the batch that was cancelled.
    await release()
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
  })
})
