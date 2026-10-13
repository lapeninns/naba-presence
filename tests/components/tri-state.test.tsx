import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { Field, FieldLabel } from "@/components/ui/field"
import { TriState } from "@/components/ui/tri-state"

function Harness({ initial }: { initial: boolean | null }) {
  const [value, setValue] = useState<boolean | null>(initial)
  return (
    <>
      <TriState
        aria-label="Wheelchair accessible"
        value={value}
        onValueChange={setValue}
      />
      <output data-testid="value">{String(value)}</output>
    </>
  )
}

describe("TriState", () => {
  it("renders Yes / No / Not set as a radio group, in that order", () => {
    render(<Harness initial={null} />)
    expect(
      screen.getByRole("radiogroup", { name: "Wheelchair accessible" })
    ).toBeInTheDocument()
    const radios = screen.getAllByRole("radio")
    expect(radios.map((radio) => radio.textContent)).toEqual([
      "Yes",
      "No",
      "Not set",
    ])
    expect(screen.getByRole("radio", { name: "Not set" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("round-trips true, false and null", async () => {
    const user = userEvent.setup()
    render(<Harness initial={null} />)
    const value = screen.getByTestId("value")

    await user.click(screen.getByRole("radio", { name: "Yes" }))
    expect(value).toHaveTextContent("true")
    await user.click(screen.getByRole("radio", { name: "No" }))
    expect(value).toHaveTextContent("false")
    await user.click(screen.getByRole("radio", { name: "Not set" }))
    expect(value).toHaveTextContent("null")

    // Arrow keys wrap: Not set -> Yes.
    await user.keyboard("{ArrowRight}")
    expect(value).toHaveTextContent("true")
  })

  it("reflects a controlled false value", () => {
    render(<Harness initial={false} />)
    expect(screen.getByRole("radio", { name: "No" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("takes custom labels and the Field label as its name", () => {
    const onValueChange = vi.fn()
    render(
      <Field>
        <FieldLabel>Serves alcohol</FieldLabel>
        <TriState
          value={true}
          onValueChange={onValueChange}
          labels={{ unset: "Unknown" }}
        />
      </Field>
    )
    expect(
      screen.getByRole("radiogroup", { name: "Serves alcohol" })
    ).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Unknown" })).toBeInTheDocument()
    expect(screen.getByRole("radio", { name: "Yes" })).toHaveAttribute(
      "aria-checked",
      "true"
    )
  })

  it("disables every segment", () => {
    render(
      <TriState
        aria-label="Wi-Fi"
        value={null}
        onValueChange={() => {}}
        disabled
      />
    )
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio).toHaveAttribute("aria-disabled", "true")
    }
  })
})
