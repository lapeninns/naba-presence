import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"

import { OnboardingOpening } from "@/components/setup/onboarding-opening"
import {
  openingDraftFromPayload,
  openingPayloadFromDraft,
  type OnboardingOpeningDraft,
} from "@/lib/locations/onboarding-opening"

import { Controlled, pick } from "./onboarding-form-helpers"

function setup(
  initial: OnboardingOpeningDraft = { status: "omit", date: null },
  error?: string
) {
  const seen: OnboardingOpeningDraft[] = []
  const user = userEvent.setup()
  render(
    <Controlled initial={initial} seen={seen}>
      {(value, set) => (
        <OnboardingOpening value={value} onChange={set} error={error} />
      )}
    </Controlled>
  )
  return { user, seen }
}

describe("OnboardingOpening", () => {
  it("proposes no state by default and will not take a date until one is chosen", () => {
    setup()
    expect(
      screen.getByRole("combobox", { name: "Opening state" })
    ).toHaveTextContent("Not supplied in this proposal")
    expect(
      screen.getByRole("button", { name: "Add opening date" })
    ).toBeDisabled()
    expect(
      screen.getByText("Choose an opening state before adding a date.")
    ).toBeInTheDocument()
  })

  it("hands back the chosen state and enables the date", async () => {
    const { user, seen } = setup()
    await pick(user, "Opening state", "Temporarily closed")
    expect(seen).toEqual([{ status: "CLOSED_TEMPORARILY", date: null }])
    expect(
      screen.getByRole("button", { name: "Add opening date" })
    ).toBeEnabled()
    expect(
      screen.queryByText("Choose an opening state before adding a date.")
    ).not.toBeInTheDocument()
  })

  it("drops the date again when the state goes back to not supplied", async () => {
    const { user, seen } = setup({
      status: "OPEN",
      date: { year: "2024", month: "5", day: "" },
    })
    await pick(user, "Opening state", "Not supplied in this proposal")
    expect(seen).toEqual([{ status: "omit", date: null }])
    expect(screen.queryByLabelText("Opening year")).not.toBeInTheDocument()
  })

  it("takes the opening date field by field, and the day is optional", async () => {
    const { user, seen } = setup({ status: "OPEN", date: null })
    await user.click(screen.getByRole("button", { name: "Add opening date" }))
    await user.type(screen.getByLabelText("Opening month"), "5")
    await user.type(screen.getByLabelText("Opening year"), "2024")

    expect(seen.at(-1)).toEqual({
      status: "OPEN",
      date: { year: "2024", month: "5", day: "" },
    })
    expect(screen.getByLabelText("Opening day (optional)")).toHaveValue("")
    expect(screen.getByLabelText("Opening year")).toHaveAttribute(
      "maxlength",
      "4"
    )
    expect(screen.getByLabelText("Opening month")).toHaveAttribute(
      "maxlength",
      "2"
    )
  })

  it("clears the date from the proposal", async () => {
    const { user, seen } = setup({
      status: "OPEN",
      date: { year: "2024", month: "5", day: "" },
    })
    await user.click(
      screen.getByRole("button", { name: "Clear opening date from proposal" })
    )
    expect(seen).toEqual([{ status: "OPEN", date: null }])
    expect(
      screen.getByRole("button", { name: "Add opening date" })
    ).toBeEnabled()
  })

  it("shows the error the draft reports and marks the date fields invalid", () => {
    setup(
      { status: "OPEN", date: { year: "20", month: "13", day: "" } },
      "Enter a valid opening month."
    )
    expect(screen.getByText("Enter a valid opening month.")).toBeInTheDocument()
    for (const name of ["Opening month", "Opening year"])
      expect(screen.getByLabelText(name)).toHaveAttribute(
        "aria-invalid",
        "true"
      )
  })
})

describe("the opening payload the draft builds from this form", () => {
  it("sends nothing when no state is proposed", () => {
    expect(
      openingPayloadFromDraft({ status: "omit", date: null }, undefined)
    ).toBeUndefined()
  })

  it("sends the state and the typed month and year, without a day that was left blank", () => {
    expect(
      openingPayloadFromDraft(
        { status: "OPEN", date: { year: "2024", month: "5", day: "" } },
        undefined
      )
    ).toEqual({ status: "OPEN", openingDate: { year: 2024, month: 5 } })
  })

  it("keeps the saved date untouched when only the state changes", () => {
    const original = {
      status: "OPEN" as const,
      openingDate: { year: 2020, month: 3, day: 14 },
    }
    expect(
      openingPayloadFromDraft(
        { ...openingDraftFromPayload(original), status: "CLOSED_TEMPORARILY" },
        original
      )
    ).toEqual({ ...original, status: "CLOSED_TEMPORARILY" })
  })

  it("turns text that is not a whole number into NaN for the schema to refuse", () => {
    const payload = openingPayloadFromDraft(
      { status: "OPEN", date: { year: "20x4", month: "5", day: "" } },
      undefined
    )
    expect(Number.isNaN(payload?.openingDate?.year)).toBe(true)
  })
})
