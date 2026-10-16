import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  batch,
  clickBehindTheModal,
  release,
  renderBar,
  settledDialog,
} from "./bulk-template-held"

const { heldImport } = await vi.hoisted(() => import("./bulk-template-gate"))
vi.mock("@/components/inbox/template-dialog-loader", () => ({
  importTemplateReplyDialog: () => heldImport(),
}))

describe("an open that is still waiting for the template code, across a change of client", () => {
  it("is cancelled by the change of scope itself, and stays cancelled when the code and the new rows arrive after it", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(await settledDialog()).toBeInTheDocument()

    // The client changes, but the list keeps the previous client's rows (the
    // old ids are still ticked and still on screen): nothing about the rows
    // has changed yet.
    await clickBehindTheModal("change the client, keep the rows")
    await waitFor(() => expect(batch()).not.toBeInTheDocument())

    // The code arrives first, then the new client's rows: neither brings it
    // back, and neither lets a batch of the old client's reviews open.
    await release()
    await clickBehindTheModal("new rows arrive")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(batch()).not.toBeInTheDocument()
  })

  it("leaves focus on the list header's control, not on the page, when the scope cancels it", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(await settledDialog()).toBeInTheDocument()

    await clickBehindTheModal("change the client, keep the rows")
    await waitFor(() => expect(batch()).not.toBeInTheDocument())

    // The opener went with the rows' bar; the dialog's own focus return has
    // nowhere to go. Focus is on something that is still there.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Select" })).toHaveFocus()
    )
  })
})
