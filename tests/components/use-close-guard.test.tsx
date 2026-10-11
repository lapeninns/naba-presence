import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { DiscardDialog } from "@/components/editors/discard-dialog"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Toaster } from "@/components/ui/toast"
import { useCloseGuard } from "@/lib/editors/use-close-guard"

function Editor({ onDiscard }: { onDiscard: () => void }) {
  const [open, setOpen] = useState(true)
  const [text, setText] = useState("")
  const close = useCloseGuard({
    isDirty: text !== "",
    onOpenChange: setOpen,
    onDiscard: () => {
      setText("")
      onDiscard()
    },
  })
  return (
    <>
      <button type="button" onClick={() => close.onOpenChange(true)}>
        Open
      </button>
      <Dialog open={open} onOpenChange={close.onOpenChange}>
        <DialogContent>
          <DialogTitle>Edit link</DialogTitle>
          <input
            aria-label="Link"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <button type="button" onClick={close.requestClose}>
            Cancel
          </button>
          <DiscardDialog
            {...close.prompt}
            title="Close without saving?"
            confirmLabel="Close and discard"
            announce={false}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}

function renderEditor() {
  const onDiscard = vi.fn()
  render(
    <Toaster>
      <Editor onDiscard={onDiscard} />
    </Toaster>
  )
  return onDiscard
}

describe("useCloseGuard", () => {
  it("closes at once while clean", async () => {
    renderEditor()
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit link" })).toBeNull()
    )
    expect(screen.queryByRole("alertdialog")).toBeNull()
  })

  it("asks before closing with edits, and keeps them when the operator stays", async () => {
    const onDiscard = renderEditor()
    fireEvent.change(screen.getByLabelText("Link"), {
      target: { value: "https://example.com" },
    })
    fireEvent.keyDown(screen.getByLabelText("Link"), { key: "Escape" })
    const prompt = await screen.findByRole("alertdialog", {
      name: "Close without saving?",
    })
    fireEvent.click(
      within(prompt).getByRole("button", { name: "Keep editing" })
    )
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull())
    expect(
      screen.getByRole("dialog", { name: "Edit link" })
    ).toBeInTheDocument()
    expect(screen.getByLabelText("Link")).toHaveValue("https://example.com")
    expect(onDiscard).not.toHaveBeenCalled()
  })

  it("discards and closes once confirmed", async () => {
    const onDiscard = renderEditor()
    fireEvent.change(screen.getByLabelText("Link"), {
      target: { value: "https://example.com" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }))
    const prompt = await screen.findByRole("alertdialog", {
      name: "Close without saving?",
    })
    fireEvent.click(
      within(prompt).getByRole("button", { name: "Close and discard" })
    )
    expect(onDiscard).toHaveBeenCalledTimes(1)
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Edit link" })).toBeNull()
    )
  })
})
