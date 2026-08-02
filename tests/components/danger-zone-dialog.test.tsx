import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { DangerZoneDialog } from "@/components/locations/danger-zone-dialog"

describe("DangerZoneDialog (typed-name confirm)", () => {
  it("keeps the destructive button disabled until the exact name is typed", async () => {
    const onConfirm = vi.fn()
    render(
      <DangerZoneDialog
        open
        onOpenChange={() => {}}
        title="Delete this location from Google?"
        description="This permanently deletes the Google listing. It cannot be undone."
        expectedName="Camden Hotel"
        confirmLabel="Delete location"
        pending={false}
        onConfirm={onConfirm}
      />
    )
    const button = screen.getByRole("button", { name: "Delete location" })
    expect(button).toBeDisabled()
    const input = screen.getByLabelText(/type the location's name/i)
    await userEvent.type(input, "camden hotel") // case-insensitive + trimmed match
    expect(button).toBeEnabled()
    await userEvent.click(button)
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })
  it("stays disabled for a wrong name", async () => {
    render(
      <DangerZoneDialog open onOpenChange={() => {}} title="t" description="d" expectedName="Camden Hotel" confirmLabel="Delete location" pending={false} onConfirm={() => {}} />
    )
    await userEvent.type(screen.getByLabelText(/type the location's name/i), "Camden")
    expect(screen.getByRole("button", { name: "Delete location" })).toBeDisabled()
  })
  it("never enables the destructive button when expectedName is empty (defence-in-depth)", () => {
    render(
      <DangerZoneDialog open onOpenChange={() => {}} title="t" description="d" expectedName="" confirmLabel="Delete location" pending={false} onConfirm={() => {}} />
    )
    expect(screen.getByRole("button", { name: "Delete location" })).toBeDisabled()
  })
})
