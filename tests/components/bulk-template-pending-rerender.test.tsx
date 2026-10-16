import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  clickBehindTheModal,
  release,
  renderBar,
  settledDialog,
  TITLE,
} from "./bulk-template-held"

const { heldImport } = await vi.hoisted(() => import("./bulk-template-gate"))
vi.mock("@/components/inbox/template-dialog-loader", () => ({
  importTemplateReplyDialog: () => heldImport(),
}))

describe("the template batch opened before its code arrived", () => {
  it("keeps the one dialog it opened when the bar re-renders after the code arrives", async () => {
    const user = userEvent.setup()
    renderBar()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    expect(await settledDialog()).toHaveTextContent("Loading…")

    await release()
    await screen.findByRole("button", { name: /^Create \d+ drafts?$/ })
    const dialog = await settledDialog()
    // State the operator has set in the dialog.
    const lowRatings = screen.getByRole("checkbox", {
      name: /Include 1–2 star ratings/,
    })
    await user.click(lowRatings)
    expect(lowRatings).toBeChecked()

    // A refetch, a window refocus: the bar renders again. The dialog must be
    // the same one, with its state, not a new one in its place.
    await clickBehindTheModal("refetch")
    await clickBehindTheModal("refetch")
    expect(screen.getByRole("dialog", { name: TITLE })).toBe(dialog)
    expect(
      screen.getByRole("button", { name: /^Create \d+ drafts?$/ })
    ).toBeInTheDocument()
  })
})
