import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

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

  it("points aria-describedby at exactly the error id when there is no description", () => {
    render(
      <Field error="Enter a business name.">
        <FieldLabel>Business name</FieldLabel>
        <Input />
        <FieldError />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    const errorId = screen.getByRole("alert").id
    expect(input).toHaveAttribute("aria-describedby", errorId)
  })

  it("omits aria-describedby entirely when neither description nor error render", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input />
      </Field>
    )
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(input).not.toHaveAttribute("aria-describedby")
  })
})

/**
 * A Select's trigger is a `<button>`, which `<label for>` cannot reach, so a
 * Field holding one hands its label over by `aria-labelledby` and stops
 * emitting `htmlFor`. A caller that names the trigger itself keeps that name:
 * `aria-labelledby` wins the name computation, so adding it unconditionally
 * would silently rewrite accessible names across the console.
 */
describe("Field wiring for a pop-up trigger", () => {
  it("names the trigger from the label and carries invalid + description", () => {
    render(
      <Field error="Pick a status.">
        <FieldLabel>Open status</FieldLabel>
        <Select value="OPEN">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
        <FieldError />
      </Field>
    )
    const trigger = screen.getByRole("combobox", { name: "Open status" })
    expect(trigger).toHaveAttribute("aria-invalid", "true")
    expect(trigger).toHaveAccessibleDescription("Pick a status.")
  })

  it("drops htmlFor, which a button could never have answered", () => {
    render(
      <Field>
        <FieldLabel>Open status</FieldLabel>
        <Select value="OPEN">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="OPEN">Open</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    )
    expect(document.querySelector("label")).not.toHaveAttribute("for")
  })

  it("leaves an explicit aria-label as the trigger's accessible name", () => {
    render(
      <Field>
        <FieldLabel>Type</FieldLabel>
        <Select value="DINING_RESERVATION">
          <SelectTrigger aria-label="Booking link type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DINING_RESERVATION">Reserve</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    )
    expect(
      screen.getByRole("combobox", { name: "Booking link type" })
    ).toBeInTheDocument()
  })

  it("keeps htmlFor for an ordinary input, which can answer it", () => {
    render(
      <Field>
        <FieldLabel>Business name</FieldLabel>
        <Input />
      </Field>
    )
    const label = document.querySelector("label")
    const input = screen.getByRole("textbox", { name: "Business name" })
    expect(label).toHaveAttribute("for", input.id)
  })
})
