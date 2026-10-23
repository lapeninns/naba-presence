import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { OnboardingHours } from "@/components/setup/onboarding-hours"
import type {
  GoogleOnboardingRegularHours,
  GoogleOnboardingSpecialHours,
} from "@/lib/domain/google-onboarding-hours"

import { Controlled, pick } from "./onboarding-form-helpers"

type State = {
  regular: GoogleOnboardingRegularHours | undefined
  special: GoogleOnboardingSpecialHours | undefined
}

const time = (hours: number, minutes = 0) => ({ hours, minutes })

function setup(initial: State = { regular: undefined, special: undefined }) {
  const seen: State[] = []
  const onEntryChange = vi.fn()
  const user = userEvent.setup()
  render(
    <Controlled initial={initial} seen={seen}>
      {(state, set) => (
        <OnboardingHours
          regular={state.regular}
          special={state.special}
          onRegularChange={(regular) => set({ ...state, regular })}
          onSpecialChange={(special) => set({ ...state, special })}
          onEntryChange={onEntryChange}
        />
      )}
    </Controlled>
  )
  return { user, seen, onEntryChange }
}

async function fillRegular(
  user: ReturnType<typeof userEvent.setup>,
  [openDay, opens, closeDay, closes]: [string, string, string, string]
) {
  await pick(user, "Regular opening day", openDay)
  await user.type(screen.getByLabelText("Regular opening time"), opens)
  await pick(user, "Regular closing day", closeDay)
  await user.type(screen.getByLabelText("Regular closing time"), closes)
}

const addRegular = () =>
  screen.getByRole("button", { name: "Add regular period" })

describe("OnboardingHours regular hours", () => {
  it("says nothing is assumed and keeps Add disabled until all four fields are set", async () => {
    const { user } = setup()
    expect(
      screen.getByText("Regular hours are not supplied in this proposal.")
    ).toBeInTheDocument()
    expect(addRegular()).toBeDisabled()
    await pick(user, "Regular opening day", "Monday")
    await user.type(screen.getByLabelText("Regular opening time"), "0900")
    await pick(user, "Regular closing day", "Monday")
    expect(addRegular()).toBeDisabled()
    await user.type(screen.getByLabelText("Regular closing time"), "1700")
    expect(addRegular()).toBeEnabled()
  })

  it("hands back the period as Google's day and time values, then clears the entry", async () => {
    const { user, seen } = setup()
    await fillRegular(user, ["Monday", "0900", "Monday", "1700"])
    await user.click(addRegular())

    expect(seen).toEqual([
      {
        regular: {
          periods: [
            {
              openDay: "MONDAY",
              openTime: { hours: 9, minutes: 0 },
              closeDay: "MONDAY",
              closeTime: { hours: 17, minutes: 0 },
            },
          ],
        },
        special: undefined,
      },
    ])
    expect(screen.getByText("Monday 09:00 to Monday 17:00")).toBeInTheDocument()
    expect(screen.getByLabelText("Regular opening time")).toHaveValue("")
    expect(addRegular()).toBeDisabled()
  })

  it("accepts 24:00 as midnight at the end of the day and an overnight close on the next day", async () => {
    const { user, seen } = setup()
    await fillRegular(user, ["Friday", "1800", "Saturday", "0100"])
    await user.click(addRegular())
    await fillRegular(user, ["Saturday", "1800", "Saturday", "2400"])
    await user.click(addRegular())

    const periods = seen.at(-1)?.regular?.periods
    expect(periods).toEqual([
      {
        openDay: "FRIDAY",
        openTime: time(18),
        closeDay: "SATURDAY",
        closeTime: time(1),
      },
      {
        openDay: "SATURDAY",
        openTime: time(18),
        closeDay: "SATURDAY",
        closeTime: time(24),
      },
    ])
  })

  it("refuses a close that is not after the open and keeps what was typed", async () => {
    const { user, seen } = setup()
    await fillRegular(user, ["Monday", "1700", "Monday", "0900"])
    await user.click(addRegular())

    expect(
      await screen.findByText(
        "Closing time must follow opening time; choose the next closing day for overnight hours."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
    expect(screen.getByLabelText("Regular opening time")).toHaveValue("17:00")
  })

  it("refuses 24:30, since 24:00 is the only time past the end of the day", async () => {
    const { user, seen } = setup()
    await fillRegular(user, ["Monday", "0900", "Tuesday", "2430"])
    await user.click(addRegular())
    expect(
      await screen.findByText("24:00 must have zero minutes.")
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("refuses a period that overlaps one already proposed", async () => {
    const { user, seen } = setup({
      regular: {
        periods: [
          {
            openDay: "MONDAY",
            openTime: time(9),
            closeDay: "MONDAY",
            closeTime: time(17),
          },
        ],
      },
      special: undefined,
    })
    await fillRegular(user, ["Monday", "1200", "Monday", "2000"])
    await user.click(addRegular())
    expect(
      await screen.findByText("Opening periods cannot overlap or repeat.")
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("tracks the half-typed entry as unsaved until it is added or discarded", async () => {
    const { user, onEntryChange } = setup()
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    await pick(user, "Regular opening day", "Tuesday")
    expect(onEntryChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.getByText(
        "Add or discard this regular entry before saving or searching."
      )
    ).toBeInTheDocument()
    await user.click(
      screen.getByRole("button", { name: "Discard regular entry" })
    )
    expect(onEntryChange).toHaveBeenLastCalledWith(false)
    expect(
      screen.queryByRole("button", { name: "Discard regular entry" })
    ).not.toBeInTheDocument()
  })

  it("removes one period, and removing the last one hands back undefined", async () => {
    const monday = {
      openDay: "MONDAY",
      openTime: time(9),
      closeDay: "MONDAY",
      closeTime: time(17),
    } as const
    const tuesday = {
      ...monday,
      openDay: "TUESDAY",
      closeDay: "TUESDAY",
    } as const
    const { user, seen } = setup({
      regular: { periods: [monday, tuesday] },
      special: undefined,
    })
    await user.click(
      screen.getByRole("button", { name: "Remove regular period 1" })
    )
    expect(seen.at(-1)?.regular).toEqual({ periods: [tuesday] })
    await user.click(
      screen.getByRole("button", { name: "Remove regular period 1" })
    )
    expect(seen.at(-1)?.regular).toBeUndefined()
  })

  it("keeps the final regular period while special dates depend on it", () => {
    setup({
      regular: {
        periods: [
          {
            openDay: "MONDAY",
            openTime: time(9),
            closeDay: "MONDAY",
            closeTime: time(17),
          },
        ],
      },
      special: {
        specialHourPeriods: [
          { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
        ],
      },
    })
    expect(
      screen.getByRole("button", { name: "Remove regular period 1" })
    ).toBeDisabled()
    expect(
      screen.getByText(
        "Remove special dates before removing the final regular period."
      )
    ).toBeInTheDocument()
  })
})

describe("OnboardingHours special dates", () => {
  const regular: GoogleOnboardingRegularHours = {
    periods: [
      {
        openDay: "MONDAY",
        openTime: time(9),
        closeDay: "MONDAY",
        closeTime: time(17),
      },
    ],
  }
  const addSpecial = () =>
    screen.getByRole("button", { name: "Add special date" })

  it("asks for regular hours first and keeps Add disabled without them", () => {
    setup()
    expect(
      screen.getByText("Add regular hours before proposing a special date.")
    ).toBeInTheDocument()
    expect(addSpecial()).toBeDisabled()
  })

  it("adds a closed-all-day date as closed, with no times", async () => {
    const { user, seen } = setup({ regular, special: undefined })
    fireDate("Special start date", "2026-12-25")
    await pick(user, "Special date opening", "Closed all day")
    await user.click(addSpecial())

    expect(seen.at(-1)?.special).toEqual({
      specialHourPeriods: [
        { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
      ],
    })
    expect(screen.getByText("2026-12-25: Closed")).toBeInTheDocument()
  })

  it("adds custom hours, with the optional end date for an overnight close", async () => {
    const { user, seen } = setup({ regular, special: undefined })
    fireDate("Special start date", "2026-12-31")
    await pick(user, "Special date opening", "Custom hours")
    expect(addSpecial()).toBeDisabled()
    await user.type(screen.getByLabelText("Special opening time"), "1800")
    await user.type(screen.getByLabelText("Special closing time"), "0200")
    fireDate("Special end date (optional)", "2027-01-01")
    await user.click(addSpecial())

    expect(seen.at(-1)?.special).toEqual({
      specialHourPeriods: [
        {
          startDate: { year: 2026, month: 12, day: 31 },
          endDate: { year: 2027, month: 1, day: 1 },
          openTime: time(18),
          closeTime: time(2),
        },
      ],
    })
  })

  it("refuses custom hours of 24 hours or more", async () => {
    const { user, seen } = setup({ regular, special: undefined })
    fireDate("Special start date", "2026-12-31")
    await pick(user, "Special date opening", "Custom hours")
    await user.type(screen.getByLabelText("Special opening time"), "0600")
    await user.type(screen.getByLabelText("Special closing time"), "0600")
    await user.click(addSpecial())
    expect(
      await screen.findByText(
        "Special hours must last less than 24 hours and end on the same date or before noon on the following date."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("refuses a second date that overlaps a closed day", async () => {
    const { user, seen } = setup({
      regular,
      special: {
        specialHourPeriods: [
          { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
        ],
      },
    })
    fireDate("Special start date", "2026-12-25")
    await pick(user, "Special date opening", "Custom hours")
    await user.type(screen.getByLabelText("Special opening time"), "1200")
    await user.type(screen.getByLabelText("Special closing time"), "1500")
    await user.click(addSpecial())
    expect(
      await screen.findByText(
        "Special dates cannot contain overlapping hours or both closed and open periods."
      )
    ).toBeInTheDocument()
    expect(seen).toEqual([])
  })

  it("removes a special date", async () => {
    const { user, seen } = setup({
      regular,
      special: {
        specialHourPeriods: [
          { startDate: { year: 2026, month: 12, day: 25 }, closed: true },
        ],
      },
    })
    const group = screen.getByRole("group", { name: "Proposed special hours" })
    await user.click(
      within(group).getByRole("button", { name: "Remove special period 1" })
    )
    expect(seen.at(-1)?.special).toBeUndefined()
  })
})

function fireDate(label: string, value: string) {
  // A native date input takes its whole value at once.
  const input = screen.getByLabelText(label) as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  )!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
