import { fireEvent, render, screen } from "@testing-library/react"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { HoursEditor } from "@/components/locations/hours-editor"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"

function Harness() {
  const [value, setValue] = useState<NormalizedHours>(emptyHours())
  return <HoursEditor value={value} onChange={setValue} disabled={false} />
}

describe("HoursEditor special hours", () => {
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
