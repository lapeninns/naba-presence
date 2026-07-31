import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

describe("Field auto-wiring", () => {
  it("associates label, description and control without explicit ids", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input defaultValue="Old Crown" />
        <FieldDescription>Shown on your Google profile.</FieldDescription>
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAccessibleDescription("Shown on your Google profile.")
    expect(input).not.toHaveAttribute("aria-invalid")
  })

  it("wires errors as an alert and marks the control invalid", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).toHaveAttribute("aria-invalid", "true")
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Enter a business name."
    )
    expect(input).toHaveAccessibleDescription("Enter a business name.")
  })

  it("Input works standalone with an explicit aria-label", () => {
    render(<Input aria-label="Search reviews" />)
    expect(
      screen.getByRole("textbox", { name: "Search reviews" })
    ).toBeInTheDocument()
  })
})
