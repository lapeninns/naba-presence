import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { HoursEditor } from "@/components/locations/hours-editor"
import { emptyHours } from "@/lib/locations/forms/hours"
import { buildGoogleHoursPatch, hashHours, normalizeGoogleHours } from "@/lib/domain/hours"

describe("hours release regressions", () => {
  it("keeps a newly added earlier service in provider order for readback", () => {
    const value = emptyHours()
    value.moreHours = [{ hoursTypeId: "KITCHEN", periods: [] }]
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} supportedHoursTypes={[
      { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
      { hoursTypeId: "BAR", displayName: "Bar" },
    ]} />)
    fireEvent.change(screen.getByLabelText("Service schedule to add"), { target: { value: "BAR" } })
    fireEvent.click(screen.getByRole("button", { name: "Add service schedule" }))
    const saved = change.mock.calls[0][0]
    expect(saved.moreHours.map((entry: { hoursTypeId: string }) => entry.hoursTypeId)).toEqual(["BAR", "KITCHEN"])
    const patch = buildGoogleHoursPatch({ canonical: saved, googleLocation: { categories: { primaryCategory: { moreHoursTypes: [{ hoursTypeId: "BAR" }, { hoursTypeId: "KITCHEN" }] } } } })
    expect(hashHours(saved)).toBe(hashHours(normalizeGoogleHours(patch.payload)))
  })

  it("hides the ignored closing date for a closed special day", () => {
    const value = emptyHours()
    value.special = [{ effectiveDate: "2099-12-24", endDate: "2099-12-26", isClosed: true, opensAt: null, closesAt: null }]
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} />)
    expect(screen.queryByLabelText("Special date 1 closing date")).not.toBeInTheDocument()
    expect(change).not.toHaveBeenCalled()
  })
})
