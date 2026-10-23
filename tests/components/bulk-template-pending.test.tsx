import { screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import {
  batch,
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

// `renderBar` gives every case a new unreleased gate and a fresh bar module, so
// the cases below can release the code in any order. "arrived" runs first on
// purpose: if its release leaked into the next case, "Loading…" would not show.

describe("the template batch once its code has arrived", () => {
  it("shows the real dialog straight away", async () => {
    const user = userEvent.setup()
    await renderBar()
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

  it("stays open when the selection goes after the code has arrived", async () => {
    const user = userEvent.setup()
    await renderBar()
    await release()
    await user.click(
      await screen.findByRole("button", { name: "Reply with template" })
    )
    const dialog = await screen.findByRole("dialog", { name: TITLE })
    // Sent replies leave the list under an open dialog: it is not cancelled.
    await clickBehindTheModal("clear the selection")
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.getByRole("dialog", { name: TITLE })).toBe(dialog)
  })
})

describe("the template batch while its code is on the way", () => {
  it("is a modal from the click, and closing it cancels the open for good", async () => {
    const user = userEvent.setup()
    await renderBar()
    const primary = await screen.findByRole("button", {
      name: "Reply with template",
    })
    await user.click(primary)

    // The code has not arrived (the deferred is held), and the batch is
    // already a modal question.
    const shell = await settledDialog()
    expect(shell).toHaveTextContent("Loading…")
    // Modal: focus is inside it, and the page behind is out of reach.
    await waitFor(() =>
      expect(shell).toContainElement(document.activeElement as HTMLElement)
    )
    expect(
      screen.queryByRole("button", { name: "clear the selection" })
    ).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
    // Focus goes back to the control that asked, not to the page.
    expect(primary).toHaveFocus()

    // The code arriving afterwards does not open the batch that was cancelled.
    await release()
    await waitFor(() => expect(batch()).not.toBeInTheDocument())
  })
})

describe("an open that is still waiting for the template code", () => {
  it("is cancelled when the selection is cleared", async () => {
    const user = userEvent.setup()
    await renderBar()
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

describe("an open that is still waiting for the template code", () => {
  it("is cancelled when the rows move to another client but the old ids are still selected", async () => {
    const user = userEvent.setup()
    await renderBar()
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

describe("an open that is still waiting for the template code, across a change of client", () => {
  it("is cancelled by the change of scope itself, and stays cancelled when the code and the new rows arrive after it", async () => {
    const user = userEvent.setup()
    await renderBar()
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
    await renderBar()
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

describe("the template batch opened before its code arrived", () => {
  it("keeps the one dialog it opened when the bar re-renders after the code arrives", async () => {
    const user = userEvent.setup()
    await renderBar()
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
