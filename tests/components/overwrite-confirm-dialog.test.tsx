import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { OverwriteConfirmDialog } from "@/components/locations/overwrite-confirm-dialog"

function renderDialog(props: { pendingLabel?: string }) {
  return render(
    <OverwriteConfirmDialog
      open
      onOpenChange={() => {}}
      title="Review removing this action link?"
      description="Nothing is sent until the review is approved and sent."
      confirmLabel="Prepare removal review"
      requireAcknowledgement={false}
      pending
      onConfirm={vi.fn()}
      {...props}
    />
  )
}

describe("OverwriteConfirmDialog", () => {
  it("says what the pending action really does", () => {
    renderDialog({ pendingLabel: "Preparing review…" })
    expect(
      screen.getByRole("button", { name: "Preparing review…" })
    ).toHaveAttribute("aria-busy", "true")
    expect(screen.queryByText(/Sending to Google/)).toBeNull()
  })

  it("never claims a send by default", () => {
    renderDialog({})
    expect(screen.getByRole("button", { name: "Working…" })).toBeInTheDocument()
    expect(screen.queryByText(/Sending to Google/)).toBeNull()
  })
})
