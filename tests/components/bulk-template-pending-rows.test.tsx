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

describe("an open that is still waiting for the template code", () => {
  it("is cancelled when the rows move to another client but the old ids are still selected", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(await settledDialog()).toBeInTheDocument()

    // A scope change does not clear the selection: the list moves to the
    // other client's rows and "a" is still ticked, but it is no longer one
    // of the rows the open was made on.
    await clickBehindTheModal("switch client")
    await waitFor(() => expect(batch()).not.toBeInTheDocument())

    await release()
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
  })
})
