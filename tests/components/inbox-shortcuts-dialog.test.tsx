import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { InboxHotkeys } from "@/components/inbox/inbox-hotkeys"
import { ShortcutsButton } from "@/components/inbox/shortcuts-button"

afterEach(() => vi.restoreAllMocks())

function renderShortcuts(handlers = { next: vi.fn(), approve: vi.fn() }) {
  render(
    <>
      <ShortcutsButton />
      <button type="button">A row</button>
      <InboxHotkeys handlers={handlers} />
    </>
  )
  return handlers
}

describe("Keyboard shortcuts dialog", () => {
  it("announces its key on the button that opens it", () => {
    renderShortcuts()
    expect(screen.getByRole("button", { name: /Shortcuts/ })).toHaveAttribute(
      "aria-keyshortcuts",
      "?"
    )
  })

  it("opens from the button and hands focus back to it on Escape", async () => {
    const user = userEvent.setup()
    renderShortcuts()
    const opener = screen.getByRole("button", { name: /Shortcuts/ })
    await user.click(opener)
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    })
    await waitFor(() =>
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
    )

    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() => expect(opener).toHaveFocus())
  })

  it("opens on ? and hands focus back to where it was", async () => {
    const user = userEvent.setup()
    renderShortcuts()
    const row = screen.getByRole("button", { name: "A row" })
    row.focus()
    await user.keyboard("?")
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" })
    await user.keyboard("{Escape}")
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    )
    await waitFor(() => expect(row).toHaveFocus())
  })

  it("keeps Tab inside, and no inbox key acts behind it", async () => {
    const user = userEvent.setup()
    const handlers = renderShortcuts()
    // Taken before it opens: the modal hides everything behind it.
    const opener = screen.getByRole("button", { name: /Shortcuts/ })
    const row = screen.getByRole("button", { name: "A row" })
    await user.keyboard("?")
    const dialog = await screen.findByRole("dialog", {
      name: "Keyboard shortcuts",
    })
    for (let step = 0; step < 4; step++) {
      await user.tab()
      // Tab past the last control lands on the trap's guard, which hands
      // focus back into the dialog a moment later.
      await waitFor(() =>
        expect(dialog).toContainElement(document.activeElement as HTMLElement)
      )
      expect(opener).not.toHaveFocus()
      expect(row).not.toHaveFocus()
    }
    // `a` behind an open dialog would press the publish bar's button.
    await user.keyboard("aj")
    expect(handlers.approve).not.toHaveBeenCalled()
    expect(handlers.next).not.toHaveBeenCalled()
    expect(within(dialog).getByText("Next review")).toBeInTheDocument()
  })
})
