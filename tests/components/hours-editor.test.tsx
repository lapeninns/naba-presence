import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { HoursEditor } from "@/components/locations/hours-editor"
import { validateHours } from "@/lib/editors/hours-presentation"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"

function Harness() {
  const [value, setValue] = useState<NormalizedHours>(emptyHours())
  return <HoursEditor value={value} onChange={setValue} disabled={false} />
}

describe("HoursEditor special hours", () => {
  it("marks and describes a malformed special closing time without invalidating its valid opening time", () => {
    const value = emptyHours()
    value.special = [
      {
        effectiveDate: "2099-12-24",
        isClosed: false,
        opensAt: "10:00",
        closesAt: "24:01",
      },
    ]
    const issues = validateHours(value)
    const closingIssue = issues.find(
      (issue) => issue.fieldId === "special-0-closes"
    )
    if (!closingIssue)
      throw new Error("Expected a closing-time validation issue")
    expect(issues.some((issue) => issue.fieldId === "special-0-opens")).toBe(
      false
    )
    render(
      <HoursEditor
        value={value}
        onChange={vi.fn()}
        disabled={false}
        errors={Object.fromEntries(
          issues.map((issue) => [issue.fieldId, issue.message])
        )}
      />
    )
    const closes = screen.getByLabelText("Special date 1 closes")
    expect(closes).toHaveAttribute("aria-invalid", "true")
    expect(closes).toHaveAccessibleDescription(closingIssue.message)
    expect(screen.getByText(closingIssue.message)).toBeVisible()
    expect(screen.getByLabelText("Special date 1 opens")).not.toHaveAttribute(
      "aria-invalid",
      "true"
    )
  })

  it("never logs a duplicate-key warning when two rows share the same effectiveDate", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<Harness />)

    const add = screen.getByRole("button", { name: "Add a special day" })
    fireEvent.click(add) // row 0 (unrelated, stays undated)
    fireEvent.click(add) // row 1
    fireEvent.click(add) // row 2

    const dates = screen.getAllByLabelText(/^Special date \d$/)
    fireEvent.change(dates[1], { target: { value: "2026-12-25" } })
    fireEvent.change(dates[2], { target: { value: "2026-12-25" } }) // deliberate collision with row 1

    const duplicateKeyWarning = errorSpy.mock.calls.some(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("two children with the same key")
    )
    expect(duplicateKeyWarning).toBe(false)
    errorSpy.mockRestore()
  })

  it("keeps focus on a colliding-date row's input when an earlier row sharing its date is removed", () => {
    render(<Harness />)

    const add = screen.getByRole("button", { name: "Add a special day" })
    fireEvent.click(add) // row 0 (removed below)
    fireEvent.click(add) // row 1 (stays focused)

    const dates = screen.getAllByLabelText(/^Special date \d$/)
    fireEvent.change(dates[0], { target: { value: "2026-12-25" } })
    fireEvent.change(dates[1], { target: { value: "2026-12-25" } }) // same date as row 0 — two overrides for the same holiday

    const focusedInput = screen.getAllByLabelText(/^Special date \d$/)[1]
    focusedInput.focus()
    expect(document.activeElement).toBe(focusedInput)

    const removeButtons = screen.getAllByRole("button", { name: "Remove" })
    fireEvent.click(removeButtons[0]) // remove row 0, leaving the focused row 1 in place

    expect(document.activeElement).toBe(focusedInput)
  })
})

describe("HoursEditor day switch and special-day order", () => {
  it("brings a day's own periods back when it is switched off and on", () => {
    render(<Harness />)
    const monday = screen.getByRole("switch", { name: "Monday open" })
    fireEvent.click(monday)
    const opens = screen.getByLabelText("Monday period 1 opens")
    fireEvent.change(opens, { target: { value: "11:30" } })

    fireEvent.click(monday) // off
    expect(screen.queryByLabelText("Monday period 1 opens")).toBeNull()
    fireEvent.click(monday) // on again
    expect(screen.getByLabelText("Monday period 1 opens")).toHaveValue("11:30")
  })

  it("lists special days by date and marks the ones already past", () => {
    render(<Harness />)
    const add = screen.getByRole("button", { name: "Add a special day" })
    fireEvent.click(add)
    fireEvent.click(add)
    const dates = screen.getAllByLabelText(/^Special date \d$/)
    fireEvent.change(dates[0], { target: { value: "2099-12-25" } })
    fireEvent.change(dates[1], { target: { value: "2000-01-01" } })

    const ordered = screen
      .getAllByLabelText(/^Special date \d$/)
      .map((input) => (input as HTMLInputElement).value)
    expect(ordered).toEqual(["2000-01-01", "2099-12-25"])
    expect(screen.getAllByText("Past")).toHaveLength(1)
  })

  it("wires the special-day closing time to the same error as its opening time", () => {
    const special = {
      ...emptyHours(),
      special: [
        {
          effectiveDate: "2099-12-24",
          isClosed: false,
          opensAt: "10:00",
          closesAt: "10:00",
        },
      ],
    }
    render(
      <HoursEditor
        value={special}
        onChange={() => {}}
        disabled={false}
        errors={{
          "special-0-opens": "Opening and closing times are the same.",
        }}
      />
    )
    const closes = screen.getByLabelText("Special date 1 closes")
    expect(closes).toHaveAttribute("id", "special-0-closes")
    expect(closes).toHaveAttribute("aria-invalid", "true")
    expect(closes).toHaveAccessibleDescription(
      "Opening and closing times are the same."
    )
  })
})

describe("HoursEditor service and boundary preservation", () => {
  it("keeps two distinct services visible and edits only the selected schedule", () => {
    const initial = emptyHours()
    initial.moreHours = [
      {
        hoursTypeId: "KITCHEN",
        periods: [
          {
            dayOfWeek: 1,
            closeDayOfWeek: 1,
            opensAt: "12:00",
            closesAt: "15:00",
          },
        ],
      },
      {
        hoursTypeId: "BAR",
        periods: [
          {
            dayOfWeek: 0,
            closeDayOfWeek: 1,
            opensAt: "18:00",
            closesAt: "02:00",
          },
        ],
      },
    ]
    const change = vi.fn()
    render(
      <HoursEditor
        value={initial}
        onChange={change}
        disabled={false}
        supportedHoursTypes={[
          { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
          { hoursTypeId: "BAR", displayName: "Bar" },
        ]}
      />
    )
    expect(
      screen.getByLabelText("Bar Sunday period 1 closing day")
    ).toHaveValue("1")
    fireEvent.change(screen.getByLabelText("Kitchen Monday period 1 closes"), {
      target: { value: "16:00" },
    })
    const next: NormalizedHours = change.mock.calls[0][0]
    expect(next.moreHours[1]).toEqual(initial.moreHours[1])
    expect(next.moreHours[0].periods[0]).toMatchObject({
      closesAt: "16:00",
      closeDayOfWeek: 1,
    })
  })

  it("shows unknown services read-only while retaining them on a venue edit", () => {
    const initial = emptyHours()
    initial.moreHours = [
      {
        hoursTypeId: "UNKNOWN_SERVICE",
        periods: [
          {
            dayOfWeek: 0,
            closeDayOfWeek: 1,
            opensAt: "18:00",
            closesAt: "02:00",
          },
        ],
      },
    ]
    const change = vi.fn()
    render(<HoursEditor value={initial} onChange={change} disabled={false} />)
    expect(
      screen.getByLabelText("UNKNOWN_SERVICE Sunday period 1 opens")
    ).toBeDisabled()
    fireEvent.click(screen.getByRole("switch", { name: "Monday open" }))
    expect(change.mock.calls[0][0].moreHours).toEqual(initial.moreHours)
    expect(screen.queryByRole("button", { name: /Remove UNKNOWN/ })).toBeNull()
  })

  it("shows 24:00 and special end dates without clearing their values", () => {
    const initial = emptyHours()
    initial.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "00:00", closesAt: "24:00", closeDayOfWeek: 1 }],
    }
    initial.special = [
      {
        effectiveDate: "2099-12-31",
        endDate: "2100-01-01",
        isClosed: false,
        opensAt: "18:00",
        closesAt: "02:00",
      },
    ]
    const change = vi.fn()
    render(<HoursEditor value={initial} onChange={change} disabled={false} />)
    expect(screen.getByLabelText("Monday period 1 closes")).toHaveValue("24:00")
    expect(screen.getByLabelText("Special date 1 closing date")).toHaveValue(
      "2100-01-01"
    )
    fireEvent.change(screen.getByLabelText("Monday period 1 opens"), {
      target: { value: "01:00" },
    })
    expect(change.mock.calls[0][0].special).toEqual(initial.special)
  })

  it("offers only supported IDs for creation and requires explicit removal confirmation", () => {
    const initial = emptyHours()
    initial.moreHours = [{ hoursTypeId: "KITCHEN", periods: [] }]
    const change = vi.fn()
    render(
      <HoursEditor
        value={initial}
        onChange={change}
        disabled={false}
        supportedHoursTypes={[
          { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
          { hoursTypeId: "BAR", displayName: "Bar" },
        ]}
      />
    )
    expect(screen.getByRole("option", { name: "Bar" })).toHaveValue("BAR")
    fireEvent.click(
      screen.getByRole("button", { name: "Remove Kitchen schedule" })
    )
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(
      screen.getByRole("button", { name: "Remove schedule from draft" })
    )
    expect(change.mock.calls[0][0].moreHours).toEqual([])
  })
})
