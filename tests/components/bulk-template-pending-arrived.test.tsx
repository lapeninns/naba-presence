import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { release, renderBar, TITLE } from "./bulk-template-held"

const { heldImport } = await vi.hoisted(() => import("./bulk-template-gate"))
vi.mock("@/components/inbox/template-dialog-loader", () => ({
  importTemplateReplyDialog: () => heldImport(),
}))

describe("the template batch once its code has arrived", () => {
  it("shows the real dialog straight away", async () => {
    const user = userEvent.setup()
    renderBar()
    await release()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    const dialog = await screen.findByRole("dialog", { name: TITLE })
    // The real batch, not the shell: its own controls are there.
    expect(dialog).not.toHaveTextContent("Loading…")
    expect(
      await screen.findByRole("button", { name: /^Create \d+ drafts?$/ })
    ).toBeInTheDocument()
  })
})
