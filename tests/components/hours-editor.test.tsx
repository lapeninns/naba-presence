import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef, useState } from "react"
import { describe, expect, it, vi } from "vitest"

import {
  HoursEditor,
  type HoursEditorHandle,
} from "@/components/locations/hours-editor"
import {
  INVALID_TIME_MESSAGE,
  validateHours,
} from "@/lib/editors/hours-presentation"
import { Toaster } from "@/components/ui/toast"
import { emptyHours } from "@/lib/locations/forms/hours"
import type { NormalizedHours } from "@/lib/api/location-hours"

function Harness() {
  const [value, setValue] = useState<NormalizedHours>(emptyHours())
  return <HoursEditor value={value} onChange={setValue} disabled={false} />
}

/** A special day's fields live in its sheet: open it from its row. */
async function openSpecialDay(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }))
  return screen.findByRole("dialog")
}

/** Close the special-day sheet with its Done button. */
async function closeSheet(dialog: HTMLElement) {
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" }))
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
}

/** A weekday's times live in its sheet: open it from its row. */
async function openDayRow(name: string) {
  fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${name}`) }))
  return screen.findByRole("dialog")
}

/** Add a special day (its sheet opens at once) and give it a date. */
async function addSpecialDay(date: string) {
  fireEvent.click(screen.getByRole("button", { name: "Add a special day" }))
  const dialog = await screen.findByRole("dialog")
  fireEvent.change(within(dialog).getByLabelText(/^Special date \d$/), {
    target: { value: date },
  })
  await closeSheet(dialog)
}

describe("HoursEditor special hours", () => {
  it("marks and describes a malformed special closing time without invalidating its valid opening time", async () => {
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
    // The closed sheet's row still says what is wrong, in words.
    const row = screen.getByRole("button", { name: /24 Dec 2099/ })
    expect(row).toHaveAccessibleDescription(closingIssue.message)
    const dialog = await openSpecialDay(/24 Dec 2099/)
    const closes = within(dialog).getByLabelText("Special date 1 closes")
    expect(closes).toHaveAttribute("aria-invalid", "true")
    expect(closes).toHaveAccessibleDescription(closingIssue.message)
    expect(within(dialog).getByText(closingIssue.message)).toBeVisible()
    expect(
      within(dialog).getByLabelText("Special date 1 opens")
    ).not.toHaveAttribute("aria-invalid", "true")
  })

  it("never logs a duplicate-key warning when two rows share the same effectiveDate", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    render(<Harness />)

    await addSpecialDay("") // row 0 (unrelated, stays undated)
    await addSpecialDay("2026-12-25") // row 1
    await addSpecialDay("2026-12-25") // row 2: deliberate collision with row 1
    expect(screen.getAllByRole("button", { name: /25 Dec 2026/ })).toHaveLength(
      2
    )

    const duplicateKeyWarning = errorSpy.mock.calls.some(
      (args) =>
        typeof args[0] === "string" &&
        args[0].includes("two children with the same key")
    )
    expect(duplicateKeyWarning).toBe(false)
    errorSpy.mockRestore()
  })

  it("keeps a colliding-date row's own element when an earlier row sharing its date is removed", async () => {
    render(<Harness />)

    await addSpecialDay("2026-12-25") // row 0 (removed below)
    await addSpecialDay("2026-12-25") // row 1: same date, two overrides for the same holiday

    const rows = screen.getAllByRole("button", { name: /25 Dec 2026/ })
    expect(rows).toHaveLength(2)
    const kept = rows[1]!

    // Remove row 0 from its sheet, leaving row 1 in place.
    fireEvent.click(rows[0]!)
    const dialog = await screen.findByRole("dialog")
    fireEvent.click(within(dialog).getByRole("button", { name: "Remove" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())

    // The stable key keeps row 1's node: nothing remounts or jumps.
    expect(screen.getAllByRole("button", { name: /25 Dec 2026/ })).toEqual([
      kept,
    ])
  })
})

describe("HoursEditor special-day focus return", () => {
  it("returns focus to the new day's row, not the Add button, after Done", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await addSpecialDay("2099-12-25")
    const add = screen.getByRole("button", { name: "Add a special day" })
    await user.click(add)
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/^Special date \d$/), {
      target: { value: "2099-01-01" },
    })
    await user.click(within(dialog).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // The new day sorts before the earlier one; focus follows it there.
    const row = screen.getByRole("button", { name: /1 Jan 2099/ })
    await waitFor(() => expect(row).toHaveFocus())
    expect(add).not.toHaveFocus()
  })

  it("returns focus to an existing day's row after editing it", async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await addSpecialDay("2099-12-25")
    await user.click(screen.getByRole("button", { name: /25 Dec 2099/ }))
    const dialog = await screen.findByRole("dialog")
    fireEvent.change(within(dialog).getByLabelText(/^Special date \d$/), {
      target: { value: "2099-12-26" },
    })
    await user.click(within(dialog).getByRole("button", { name: "Done" }))
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /26 Dec 2099/ })).toHaveFocus()
    )
  })
})

describe("HoursEditor day switch and special-day order", () => {
  it("brings a day's own periods back when it is switched off and on", async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole("switch", { name: "Monday open" }))
    const dialog = await openDayRow("Monday")
    fireEvent.change(within(dialog).getByLabelText("Monday period 1 opens"), {
      target: { value: "11:30" },
    })
    // The sheet's switch is named by its visible words.
    const monday = within(dialog).getByRole("switch", {
      name: "Open on Monday",
    })
    expect(within(dialog).getByText("Open on Monday")).toBeVisible()

    fireEvent.click(monday) // off
    expect(within(dialog).queryByLabelText("Monday period 1 opens")).toBeNull()
    expect(monday).toHaveAccessibleDescription("Closed all day.")
    fireEvent.click(monday) // on again
    expect(within(dialog).getByLabelText("Monday period 1 opens")).toHaveValue(
      "11:30"
    )
  })

  it("shows each day as one row with its hours and a switch beside it", () => {
    const value = emptyHours()
    value.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00", closeDayOfWeek: 1 }],
    }
    render(<HoursEditor value={value} onChange={() => {}} disabled={false} />)
    const row = screen.getByRole("button", { name: /^Monday/ })
    expect(row).toHaveTextContent("09:00 – 17:00")
    expect(screen.getByRole("button", { name: /^Tuesday/ })).toHaveTextContent(
      "Closed"
    )
    // The period fields are not on the page until the day's sheet opens.
    expect(screen.queryByLabelText("Monday period 1 opens")).toBeNull()
    expect(screen.getByRole("switch", { name: "Monday open" })).toBeChecked()
  })

  it("lists special days by date and marks the ones already past", async () => {
    render(<Harness />)
    await addSpecialDay("2099-12-25")
    await addSpecialDay("2000-01-01")

    const ordered = screen
      .getAllByRole("button", { name: /Dec 2099|Jan 2000/ })
      .map((row) => row.textContent)
    expect(ordered[0]).toMatch(/1 Jan 2000/)
    expect(ordered[1]).toMatch(/25 Dec 2099/)
    expect(screen.getAllByText("Past")).toHaveLength(1)
  })

  it("wires the special-day closing time to the same error as its opening time", async () => {
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
    const dialog = await openSpecialDay(/24 Dec 2099/)
    const closes = within(dialog).getByLabelText("Special date 1 closes")
    expect(closes).toHaveAttribute("id", "special-0-closes")
    expect(closes).toHaveAttribute("aria-invalid", "true")
    expect(closes).toHaveAccessibleDescription(
      "Opening and closing times are the same."
    )
  })
})

describe("HoursEditor service and boundary preservation", () => {
  it("keeps two distinct services visible and edits only the selected schedule", async () => {
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
    // Google's names, not its raw type ids, and what the group is for.
    expect(screen.queryByText("KITCHEN")).toBeNull()
    expect(
      screen.getByRole("region", { name: "Service hours" })
    ).toHaveAccessibleDescription(
      "Separate hours for services such as a kitchen, delivery or takeaway."
    )
    const barDay = await openDayRow("Bar Sunday")
    expect(
      within(barDay).getByRole("combobox", {
        name: "Bar Sunday period 1 closing day",
      })
    ).toHaveTextContent("Next day (Monday)")
    await closeSheet(barDay)
    const kitchenDay = await openDayRow("Kitchen Monday")
    fireEvent.change(
      within(kitchenDay).getByLabelText("Kitchen Monday period 1 closes"),
      { target: { value: "16:00" } }
    )
    const next: NormalizedHours = change.mock.calls[0][0]
    expect(next.moreHours[1]).toEqual(initial.moreHours[1])
    expect(next.moreHours[0].periods[0]).toMatchObject({
      closesAt: "16:00",
      closeDayOfWeek: 1,
    })
  })

  it("shows unknown services read-only while retaining them on a venue edit", async () => {
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
    // With no name from Google, the raw id is the only way to tell it apart.
    expect(
      screen.getByText(/^UNKNOWN_SERVICE · Google has not confirmed/)
    ).toBeInTheDocument()
    const unknownDay = await openDayRow("UNKNOWN_SERVICE Sunday")
    expect(
      within(unknownDay).getByLabelText("UNKNOWN_SERVICE Sunday period 1 opens")
    ).toBeDisabled()
    await closeSheet(unknownDay)
    fireEvent.click(screen.getByRole("switch", { name: "Monday open" }))
    expect(change.mock.calls[0][0].moreHours).toEqual(initial.moreHours)
    expect(screen.queryByRole("button", { name: /Remove UNKNOWN/ })).toBeNull()
  })

  it("shows 24:00 and special end dates without clearing their values", async () => {
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
    const mondaySheet = await openDayRow("Monday")
    expect(
      within(mondaySheet).getByLabelText("Monday period 1 closes")
    ).toHaveValue("24:00")
    fireEvent.change(
      within(mondaySheet).getByLabelText("Monday period 1 opens"),
      { target: { value: "01:00" } }
    )
    expect(change.mock.calls[0][0].special).toEqual(initial.special)
    await closeSheet(mondaySheet)
    const dialog = await openSpecialDay(/31 Dec 2099/)
    expect(
      within(dialog).getByLabelText("Special date 1 closing date")
    ).toHaveValue("2100-01-01")
    // Opening the sheet is not an edit.
    expect(change).toHaveBeenCalledTimes(1)
  })

  it("offers only supported IDs for creation and requires explicit removal confirmation", async () => {
    const user = userEvent.setup()
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
    await user.click(
      screen.getByRole("button", { name: "Add service schedule" })
    )
    const picker = await screen.findByRole("listbox", {
      name: "Service schedule to add",
    })
    expect(
      within(picker)
        .getAllByRole("option")
        .map((o) => o.textContent)
    ).toEqual(["Bar"])
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
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

describe("HoursEditor phone-first controls", () => {
  it("edits times on the numeric pad and tidies loose input on blur", async () => {
    const value = emptyHours()
    value.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "09:00", closesAt: "17:00", closeDayOfWeek: 1 }],
    }
    function Controlled() {
      const [hours, setHours] = useState(value)
      return <HoursEditor value={hours} onChange={setHours} disabled={false} />
    }
    render(<Controlled />)
    const sheet = await openDayRow("Monday")
    const opens = within(sheet).getByLabelText("Monday period 1 opens")
    expect(opens).toHaveAttribute("inputmode", "numeric")
    expect(opens).toHaveAttribute("id", "hours-1-0-opens")
    for (const [typed, tidy] of [
      ["9", "09:00"],
      ["930", "09:30"],
      ["9:30", "09:30"],
      ["0930", "09:30"],
      ["24", "24:00"],
    ]) {
      fireEvent.change(opens, { target: { value: typed } })
      fireEvent.blur(opens)
      expect(opens).toHaveValue(tidy)
    }
  })

  it("keeps the contract strict and names a good time when one is wrong", () => {
    const value = emptyHours()
    value.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "25:00", closesAt: "17:00", closeDayOfWeek: 1 }],
    }
    value.special = [
      {
        effectiveDate: "not-a-date",
        isClosed: true,
        opensAt: null,
        closesAt: null,
      },
    ]
    const issues = validateHours(value)
    expect(issues).toContainEqual(
      expect.objectContaining({
        fieldId: "hours-1-0-opens",
        message: INVALID_TIME_MESSAGE,
      })
    )
    expect(issues).toContainEqual(
      expect.objectContaining({
        fieldId: "special-0-date",
        message: "Enter a valid date.",
      })
    )
  })

  it("asks for the closing day of an overnight period and sets it from the sheet", async () => {
    const user = userEvent.setup()
    const value = emptyHours()
    value.regular[5] = {
      dayOfWeek: 5,
      isClosed: false,
      periods: [{ opensAt: "18:00", closesAt: "02:00" }],
    }
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} />)
    const fridaySheet = await openDayRow("Friday")
    const closingDay = within(fridaySheet).getByRole("combobox", {
      name: "Friday period 1 closing day",
    })
    expect(closingDay).toHaveAttribute("id", "hours-5-0-end")
    expect(closingDay).toHaveTextContent("Choose closing day")
    await user.click(closingDay)
    await user.click(
      await screen.findByRole("option", { name: "Next day (Saturday)" })
    )
    expect(change.mock.calls[0][0].regular[5].periods[0]).toMatchObject({
      opensAt: "18:00",
      closesAt: "02:00",
      closeDayOfWeek: 6,
    })
  })

  it("chooses Closed or Custom hours for a special day as a radio pair", async () => {
    function Controlled() {
      const [hours, setHours] = useState<NormalizedHours>({
        ...emptyHours(),
        special: [
          {
            effectiveDate: "2099-12-24",
            isClosed: true,
            opensAt: null,
            closesAt: null,
          },
        ],
      })
      return <HoursEditor value={hours} onChange={setHours} disabled={false} />
    }
    render(<Controlled />)
    const dialog = await openSpecialDay(/24 Dec 2099/)
    const group = within(dialog).getByRole("radiogroup", {
      name: "Special date 1 hours",
    })
    expect(within(group).getByRole("radio", { name: "Closed" })).toBeChecked()
    fireEvent.click(within(group).getByRole("radio", { name: "Custom hours" }))
    expect(
      within(group).getByRole("radio", { name: "Custom hours" })
    ).toBeChecked()
    expect(within(dialog).getByLabelText("Special date 1 opens")).toHaveValue(
      "09:00"
    )
    expect(within(dialog).getByLabelText("Special date 1 closes")).toHaveValue(
      "17:00"
    )
  })

  it("reveals a field in a service schedule's day sheet from a validation link", async () => {
    const value = emptyHours()
    value.moreHours = [
      {
        hoursTypeId: "KITCHEN",
        periods: [
          {
            dayOfWeek: 1,
            closeDayOfWeek: 1,
            opensAt: "12:00",
            closesAt: "12:00",
          },
        ],
      },
    ]
    const message = "Opening and closing times are the same."
    const handle = createRef<HoursEditorHandle>()
    render(
      <HoursEditor
        ref={handle}
        value={value}
        onChange={() => {}}
        disabled={false}
        supportedHoursTypes={[
          { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
        ]}
        errors={{ "service-KITCHEN-hours-1-0-opens": message }}
      />
    )
    // The row says what is wrong before anything is opened.
    expect(
      screen.getByRole("button", { name: /^Kitchen Monday/ })
    ).toHaveAccessibleDescription(message)
    await act(async () => {
      await handle.current!.reveal("service-KITCHEN-hours-1-0-opens")
    })
    const sheet = await screen.findByRole("dialog", {
      name: "Kitchen Monday hours",
    })
    expect(
      within(sheet).getByLabelText("Kitchen Monday period 1 opens")
    ).toHaveAttribute("aria-invalid", "true")
  })

  it("copies from the day's own sheet by closing it first, never stacking sheets", async () => {
    const value = emptyHours()
    value.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "10:00", closesAt: "22:00", closeDayOfWeek: 1 }],
    }
    render(<HoursEditor value={value} onChange={() => {}} disabled={false} />)
    const day = await openDayRow("Monday")
    fireEvent.click(
      within(day).getByRole("button", { name: "Copy to… (Monday’s hours)" })
    )
    await screen.findByRole("dialog", { name: "Copy Monday’s hours" })
    await waitFor(() => expect(screen.getAllByRole("dialog")).toHaveLength(1))
  })

  it("copies a day's hours from a dialog that does not open over another dialog", async () => {
    const user = userEvent.setup()
    const value = emptyHours()
    value.regular[1] = {
      dayOfWeek: 1,
      isClosed: false,
      periods: [{ opensAt: "10:00", closesAt: "22:00", closeDayOfWeek: 1 }],
    }
    const change = vi.fn()
    render(<HoursEditor value={value} onChange={change} disabled={false} />)
    // One Copy action in the group header, not one on every day.
    expect(screen.getAllByRole("button", { name: /^Copy .*to…/ })).toHaveLength(
      1
    )
    await user.click(screen.getByRole("button", { name: "Copy Monday to…" }))
    const dialog = await screen.findByRole("dialog")
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    await user.click(within(dialog).getByRole("button", { name: "Weekdays" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Copy to 4 days" })
    )
    const next: NormalizedHours = change.mock.calls[0][0]
    for (const day of [2, 3, 4, 5])
      expect(next.regular[day]).toMatchObject({
        isClosed: false,
        periods: [{ opensAt: "10:00", closesAt: "22:00", closeDayOfWeek: day }],
      })
    expect(next.regular[6]).toEqual(value.regular[6])
  })
})

describe("HoursEditor service hours empty state", () => {
  it("says when Google offers no service hours for the category", () => {
    render(
      <HoursEditor value={emptyHours()} onChange={() => {}} disabled={false} />
    )
    expect(
      screen.getByText(
        "Google doesn’t offer service hours for this business’s category."
      )
    ).toBeInTheDocument()
  })

  it("says only that there are none yet when services can be added", () => {
    render(
      <HoursEditor
        value={emptyHours()}
        onChange={() => {}}
        disabled={false}
        supportedHoursTypes={[
          { hoursTypeId: "KITCHEN", displayName: "Kitchen" },
        ]}
      />
    )
    expect(screen.getByText("No service schedules yet.")).toBeInTheDocument()
  })
})

function withDay(
  dayOfWeek: number,
  periods: NormalizedHours["regular"][number]["periods"]
): NormalizedHours {
  const value = emptyHours()
  value.regular[dayOfWeek] = { dayOfWeek, isClosed: false, periods }
  return value
}

/** A controlled editor, so sheet edits re-render as they do in the tab. */
function Live({ initial }: { initial: NormalizedHours }) {
  const [hours, setHours] = useState(initial)
  return (
    <Toaster>
      <HoursEditor value={hours} onChange={setHours} disabled={false} />
    </Toaster>
  )
}

describe("HoursEditor overnight periods", () => {
  it("flags a period that closes before it opens and offers the next day", async () => {
    const change = vi.fn()
    render(
      <HoursEditor
        value={withDay(5, [
          { opensAt: "18:00", closesAt: "02:00", closeDayOfWeek: 5 },
        ])}
        onChange={change}
        disabled={false}
      />
    )
    const sheet = await openDayRow("Friday")
    const hint = within(sheet).getByText(
      "Open past midnight? Close on the next day."
    )
    expect(
      within(sheet).getByRole("combobox", {
        name: "Friday period 1 closing day",
      })
    ).toHaveAccessibleDescription(hint.textContent!)
    // Nothing is chosen until the operator taps the choice.
    expect(change).not.toHaveBeenCalled()
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Close on Saturday" })
    )
    expect(change.mock.calls[0][0].regular[5].periods[0]).toMatchObject({
      opensAt: "18:00",
      closesAt: "02:00",
      closeDayOfWeek: 6,
    })
  })

  it("says how to close at midnight when the closing time is 00:00", async () => {
    render(
      <HoursEditor
        value={withDay(5, [
          { opensAt: "18:00", closesAt: "00:00", closeDayOfWeek: 5 },
        ])}
        onChange={() => {}}
        disabled={false}
      />
    )
    const sheet = await openDayRow("Friday")
    expect(
      within(sheet).getByText(
        "Closing at midnight? Close on the next day, or enter 24:00."
      )
    ).toBeInTheDocument()
  })

  it("says nothing for a period that closes later the same day", async () => {
    render(
      <HoursEditor
        value={withDay(5, [
          { opensAt: "09:00", closesAt: "17:00", closeDayOfWeek: 5 },
        ])}
        onChange={() => {}}
        disabled={false}
      />
    )
    const sheet = await openDayRow("Friday")
    expect(within(sheet).queryByText(/past midnight|at midnight/)).toBeNull()
    expect(
      within(sheet).queryByRole("button", { name: /^Close on/ })
    ).toBeNull()
  })

  it("moves focus to the closing day once the next day is chosen", async () => {
    render(
      <Live
        initial={withDay(5, [
          { opensAt: "18:00", closesAt: "02:00", closeDayOfWeek: 5 },
        ])}
      />
    )
    const sheet = await openDayRow("Friday")
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Close on Saturday" })
    )
    const closingDay = within(sheet).getByRole("combobox", {
      name: "Friday period 1 closing day",
    })
    await waitFor(() => expect(closingDay).toHaveFocus())
    expect(closingDay).toHaveTextContent("Next day (Saturday)")
    expect(
      within(sheet).queryByRole("button", { name: /^Close on/ })
    ).toBeNull()
  })
})

describe("HoursEditor day sheet labels and split periods", () => {
  it("labels each time field in words", async () => {
    render(
      <HoursEditor
        value={withDay(1, [
          { opensAt: "09:00", closesAt: "17:00", closeDayOfWeek: 1 },
        ])}
        onChange={() => {}}
        disabled={false}
      />
    )
    const sheet = await openDayRow("Monday")
    expect(within(sheet).getByText("Opens")).toBeVisible()
    expect(within(sheet).getByText("Closes")).toBeVisible()
    expect(within(sheet).getByText("Closing day")).toBeVisible()
    // The names still contain the visible words (WCAG 2.5.3).
    expect(within(sheet).getByLabelText("Monday period 1 opens")).toBeVisible()
  })

  it("says it splits a long period, and focuses the new one", async () => {
    render(
      <Live
        initial={withDay(1, [
          { opensAt: "09:00", closesAt: "17:00", closeDayOfWeek: 1 },
        ])}
      />
    )
    const sheet = await openDayRow("Monday")
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Split into two periods" })
    )
    const second = await within(sheet).findByLabelText("Monday period 2 opens")
    await waitFor(() => expect(second).toHaveFocus())
    expect(within(sheet).getByText("Period 2")).toBeVisible()
  })

  it("focuses the period before one that is removed", async () => {
    render(
      <Live
        initial={withDay(1, [
          { opensAt: "09:00", closesAt: "12:00", closeDayOfWeek: 1 },
          { opensAt: "17:00", closesAt: "22:00", closeDayOfWeek: 1 },
        ])}
      />
    )
    const sheet = await openDayRow("Monday")
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Remove Monday period 2" })
    )
    await waitFor(() =>
      expect(
        within(sheet).getByLabelText("Monday period 1 opens")
      ).toHaveFocus()
    )
    expect(within(sheet).queryByLabelText("Monday period 2 opens")).toBeNull()
  })

  it("says why no more periods can be added", async () => {
    render(
      <HoursEditor
        value={withDay(1, [
          { opensAt: "08:00", closesAt: "10:00", closeDayOfWeek: 1 },
          { opensAt: "12:00", closesAt: "14:00", closeDayOfWeek: 1 },
          { opensAt: "18:00", closesAt: "21:00", closeDayOfWeek: 1 },
        ])}
        onChange={() => {}}
        disabled={false}
      />
    )
    const sheet = await openDayRow("Monday")
    expect(
      within(sheet).getByText("A day can have up to 3 opening periods.")
    ).toBeInTheDocument()
    expect(
      within(sheet).queryByRole("button", { name: /period$|periods$/ })
    ).toBeNull()
  })
})

describe("HoursEditor special-day labels", () => {
  it("labels the special-day fields in words", async () => {
    const value = emptyHours()
    value.special = [
      {
        effectiveDate: "2099-12-24",
        endDate: "2099-12-24",
        isClosed: false,
        opensAt: "10:00",
        closesAt: "16:00",
      },
    ]
    render(<HoursEditor value={value} onChange={() => {}} disabled={false} />)
    const dialog = await openSpecialDay(/24 Dec 2099/)
    for (const words of ["Date", "Opens", "Closes", "Closing date"])
      expect(within(dialog).getByText(words)).toBeVisible()
    expect(
      within(dialog).getByLabelText("Special date 1 closing date")
    ).toHaveAccessibleDescription(
      "Change the closing date only if you close after midnight."
    )
  })
})

describe("HoursEditor copy days", () => {
  it("says which days the hours were copied to, and that Google is untouched", async () => {
    const user = userEvent.setup()
    render(
      <Live
        initial={withDay(1, [
          { opensAt: "10:00", closesAt: "22:00", closeDayOfWeek: 1 },
        ])}
      />
    )
    await user.click(screen.getByRole("button", { name: "Copy Monday to…" }))
    const dialog = await screen.findByRole("dialog")
    await user.click(within(dialog).getByRole("button", { name: "Weekdays" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Copy to 4 days" })
    )
    expect(
      await screen.findByText("Monday’s hours copied to 4 days")
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        "Tuesday, Wednesday, Thursday and Friday. Nothing reaches Google until you publish."
      )
    ).toBeInTheDocument()
  })

  it("returns focus to the header action after a copy from a day's sheet", async () => {
    const user = userEvent.setup()
    render(
      <Live
        initial={withDay(3, [
          { opensAt: "10:00", closesAt: "22:00", closeDayOfWeek: 3 },
        ])}
      />
    )
    // A copy from Wednesday's own sheet returns to Wednesday's row…
    const wednesday = await openDayRow("Wednesday")
    await user.click(
      within(wednesday).getByRole("button", {
        name: "Copy to… (Wednesday’s hours)",
      })
    )
    await screen.findByRole("dialog", { name: "Copy Wednesday’s hours" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    // …but a later copy from the header goes back to the header.
    const header = screen.getByRole("button", { name: "Copy Monday to…" })
    await user.click(header)
    await screen.findByRole("dialog", { name: "Copy Monday’s hours" })
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    await waitFor(() => expect(header).toHaveFocus())
  })
})
