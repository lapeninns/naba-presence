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
  it("is cancelled when the selection is cleared", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(await settledDialog()).toBeInTheDocument()

    await clickBehindTheModal("clear the selection")
    await waitFor(() => expect(batch()).not.toBeInTheDocument())

    // The code arrives later: nothing opens.
    await release()
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
    expect(
      screen.queryByRole("region", { name: "Selected reviews" })
    ).not.toBeInTheDocument()
  })
})
