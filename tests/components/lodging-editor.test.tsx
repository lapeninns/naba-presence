import { useState } from "react"
import { fireEvent, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { LodgingEditor } from "@/components/locations/profile/sections/lodging-editor"
import { LodgingSuggestions } from "@/components/locations/profile/sections/lodging-suggestions"
import { renderWithProviders } from "../helpers/render"

function Editor({ initial = {}, disabled = false, errors = {} }: {
  initial?: Record<string, unknown>; disabled?: boolean; errors?: Record<string, string>
}) {
  const [draft, setDraft] = useState(initial)
  return <><LodgingEditor value={draft} baseline={initial} disabled={disabled} errors={errors} onChange={setDraft} /><output data-testid="draft">{JSON.stringify(draft)}</output></>
}

describe("complete lodging editor", () => {
  it("keeps an unknown boolean distinct from No, preserves future siblings, and resets only the edited field", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor initial={{ pets: { futureRule: "preserve" } }} />)
    await user.type(screen.getByRole("searchbox", { name: "Find a lodging detail" }), "Pets allowed")
    const control = screen.getByRole("combobox", { name: "Pets allowed" })
    expect(control).toHaveTextContent("Not recorded")
    await user.click(control)
    await user.click(await screen.findByRole("option", { name: "No" }))
    expect(screen.getByTestId("draft")).toHaveTextContent('"petsAllowed":false')
    expect(screen.getByTestId("draft")).toHaveTextContent('"futureRule":"preserve"')
    await user.click(screen.getByRole("button", { name: "Reset pets allowed" }))
    expect(control).toHaveTextContent("Not recorded")
    expect(screen.getByTestId("draft")).toHaveTextContent('{"pets":{"futureRule":"preserve"}}')
  })

  it("edits conditional availability separately from the boolean", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor initial={{ pets: { petsAllowed: false } }} />)
    await user.type(screen.getByRole("searchbox"), "Pets allowed exception")
    await user.click(screen.getByRole("combobox", { name: "Pets allowed exception" }))
    await user.click(await screen.findByRole("option", { name: "Depends on season" }))
    expect(screen.getByTestId("draft")).toHaveTextContent('"petsAllowed":false')
    expect(screen.getByTestId("draft")).toHaveTextContent('"petsAllowedException":"DEPENDENT_ON_SEASON"')
  })

  it("edits check-in time as one 24-hour value, keeping a recorded midnight and extra precision", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor initial={{ policies: { checkinTime: { hours: 0, seconds: 5, nanos: 7 } } }} />)
    await user.type(screen.getByRole("searchbox"), "Checkin time")
    const time = screen.getByLabelText("Check-in time")
    expect(time).toHaveAttribute("type", "time")
    expect(time).toHaveValue("00:00")
    for (const part of ["Hours", "Minutes", "Seconds", "Nanos"]) expect(screen.queryByRole("spinbutton", { name: part })).not.toBeInTheDocument()
    fireEvent.change(time, { target: { value: "15:30" } })
    expect(screen.getByTestId("draft")).toHaveTextContent('{"policies":{"checkinTime":{"hours":15,"seconds":5,"nanos":7,"minutes":30}}}')
    await user.click(screen.getByRole("button", { name: "Reset check-in time" }))
    expect(time).toHaveValue("00:00")
  })

  it("keeps an unrecorded time distinct from midnight and clears back to unrecorded", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor errors={{ "policies.checkoutTime": "Checkout time: enter a time between 00:00 and 23:59." }} />)
    await user.type(screen.getByRole("searchbox"), "Checkout time")
    const time = screen.getByLabelText("Checkout time")
    expect(time).toHaveValue("")
    expect(time).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByText("Checkout time: enter a time between 00:00 and 23:59.")).toBeInTheDocument()
    fireEvent.change(time, { target: { value: "11:00" } })
    expect(screen.getByTestId("draft")).toHaveTextContent('{"policies":{"checkoutTime":{"hours":11,"minutes":0}}}')
    fireEvent.change(time, { target: { value: "" } })
    expect(screen.getByTestId("draft")).toHaveTextContent('{"policies":{}}')
  })

  it("marks collapsed groups and collection items that hold invalid details and jumps to the first one", async () => {
    const user = userEvent.setup()
    const errors = { "guestUnits.0.codes": "Add at least one room or unit code for this guest unit type.", "guestUnits.0.label": "Enter a short name for this guest unit type, such as Deluxe king room." }
    renderWithProviders(<Editor initial={{ guestUnits: [{}] }} errors={errors} />)
    const toggle = screen.getByRole("button", { name: "Guest units" })
    expect(toggle).toHaveAttribute("aria-expanded", "false")
    expect(toggle).toHaveAccessibleDescription("2 details to correct")
    expect(screen.getByRole("button", { name: "Pets" })).not.toHaveAccessibleDescription()
    await user.click(screen.getByRole("button", { name: "Guest units: 2 details to correct" }))
    expect(toggle).toHaveAttribute("aria-expanded", "true")
    const label = screen.getByRole("textbox", { name: "Label" })
    expect(screen.getAllByText("2 details to correct")).toHaveLength(2)
    expect(screen.getByText(errors["guestUnits.0.codes"])).toHaveFocus()
    expect(label).toHaveAttribute("aria-invalid", "true")
  })

  it("explains required guest-unit details without type jargon or contradictory Google wording", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor errors={{ "guestUnits.0.label": "Enter a short name for this guest unit type, such as Deluxe king room." }} />)
    await user.click(screen.getByRole("button", { name: "Guest units" }))
    expect(screen.getByText("Google has not recorded this list.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add guest units item" }))
    expect(screen.getByText("Enter a short name for this guest unit type, such as Deluxe king room.")).toBeInTheDocument()
    expect(screen.getByText(/Required\. A short name guests will recognise/)).toBeInTheDocument()
    expect(screen.queryByText(/supported (array|string) value/)).not.toBeInTheDocument()
    expect(screen.queryByText("Google has not recorded a value for this detail.")).not.toBeInTheDocument()
    expect(screen.getAllByText("Not set yet.").length).toBeGreaterThan(0)
    expect(screen.getByRole("combobox", { name: "TV" })).toBeInTheDocument()
    expect(screen.getByRole("combobox", { name: "In-unit safe" })).toBeInTheDocument()
  })

  it("distinguishes an unknown repeated list from an explicitly emptied list", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor />)
    await user.type(screen.getByRole("searchbox"), "Languages spoken")
    expect(screen.getByText("Google has not recorded this list.")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Add languages spoken item" }))
    expect(screen.getByRole("button", { name: "Remove languages spoken 1" })).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Remove languages spoken 1" }))
    expect(screen.getByText("The recorded list is empty.")).toBeInTheDocument()
    expect(screen.getByTestId("draft")).toHaveTextContent('"languagesSpoken":[]')
  })

  it("preserves unsupported list values and prevents disabled edits", async () => {
    const user = userEvent.setup()
    renderWithProviders(<Editor disabled initial={{ services: { languagesSpoken: "future format" } }} />)
    await user.type(screen.getByRole("searchbox"), "Languages spoken")
    expect(screen.getByText(/Google supplied an unsupported list value/)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Add languages spoken item" })).toBeDisabled()
    expect(screen.getByTestId("draft")).toHaveTextContent('"languagesSpoken":"future format"')
  })
})

describe("per-field lodging suggestions", () => {
  it("applies only the selected field into a draft without dropping unrelated edits", async () => {
    function Suggestions() {
      const [draft, setDraft] = useState<Record<string, unknown>>({ pets: { petsAllowed: false, dogsAllowed: false }, property: { roomsCount: 12 } })
      return <><LodgingSuggestions value={draft} response={{ lodging: { pets: { petsAllowed: true, dogsAllowed: true } }, diffMask: "pets.petsAllowed,pets.dogsAllowed" }} error={null} disabled={false} onChange={setDraft} /><output data-testid="draft">{JSON.stringify(draft)}</output></>
    }
    renderWithProviders(<Suggestions />)
    await userEvent.click(screen.getByRole("button", { name: "Apply suggested pets allowed to draft" }))
    expect(screen.getByTestId("draft")).toHaveTextContent('"petsAllowed":true,"dogsAllowed":false')
    expect(screen.getByTestId("draft")).toHaveTextContent('"roomsCount":12')
    expect(screen.getByRole("button", { name: "Apply suggested dogs allowed to draft" })).toBeInTheDocument()
  })

  it("preserves the draft when suggestions are unreadable", () => {
    renderWithProviders(<LodgingSuggestions value={{ pets: { petsAllowed: false } }} response={{ diffMask: "pets", pets: {} }} error={null} disabled={false} onChange={() => { throw new Error("Unexpected draft mutation") }} />)
    expect(screen.getByRole("status")).toHaveTextContent("Your current draft is preserved")
    expect(screen.queryByRole("button")).not.toBeInTheDocument()
  })
})
