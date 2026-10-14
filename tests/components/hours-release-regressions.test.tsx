import { fireEvent, render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import userEvent from "@testing-library/user-event"
import { HoursEditor } from "@/components/locations/hours-editor"
import { emptyHours } from "@/lib/locations/forms/hours"
import { buildGoogleHoursPatch, hashHours, normalizeGoogleHours } from "@/lib/domain/hours"

describe("hours release regressions", () => {
  it("keeps a newly added earlier service in provider order for readback", async () => {
    const user = userEvent.setup()
    const value = emptyHours()
    value.moreHours = [{ hoursTypeId: "KITCHEN", periods: [] }]
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} supportedHoursTypes={[
      { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
      { hoursTypeId: "BAR", displayName: "Bar" },
    ]} />)
    // The picker is a short choice list: choosing a service adds it.
    await user.click(screen.getByRole("button", { name: "Add service schedule" }))
    await user.click(await screen.findByRole("option", { name: "Bar" }))
    const saved = change.mock.calls[0][0]
    expect(saved.moreHours.map((entry: { hoursTypeId: string }) => entry.hoursTypeId)).toEqual(["BAR", "KITCHEN"])
    const patch = buildGoogleHoursPatch({ canonical: saved, googleLocation: { categories: { primaryCategory: { moreHoursTypes: [{ hoursTypeId: "BAR" }, { hoursTypeId: "KITCHEN" }] } } } })
    expect(hashHours(saved)).toBe(hashHours(normalizeGoogleHours(patch.payload)))
  })

  it("hides the ignored closing date for a closed special day", async () => {
    const value = emptyHours()
    value.special = [{ effectiveDate: "2099-12-24", endDate: "2099-12-26", isClosed: true, opensAt: null, closesAt: null }]
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} />)
    fireEvent.click(screen.getByRole("button", { name: /24 Dec 2099/ }))
    const dialog = await screen.findByRole("dialog")
    expect(within(dialog).getByLabelText("Special date 1")).toHaveValue("2099-12-24")
    expect(within(dialog).queryByLabelText("Special date 1 closing date")).not.toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
  })
})
